// comfyui-lighthouse — graph-distance highlighting on selection.
//
// When the mode is on, clicking any node lights up the rest of the graph
// according to how many connections away each node is from the click
// target. Direct neighbours glow red, one step further orange, then yellow,
// green, blue, fading off after that.
//
// Implementation:
//   - Toggleable via two right-click menu items ("Lighthouse: ON" /
//     "Lighthouse: OFF").
//   - Selection is observed by hooking LGraphCanvas.onNodeSelected /
//     onNodeDeselected.
//   - On selection change we BFS the graph from the selected node id,
//     walking both input.link and output.links arrays, and build a
//     {nodeId: distance} map.
//   - The overlay is drawn by extending LGraphCanvas.prototype.drawNode —
//     after each node finishes rendering we stroke a coloured ring around
//     its body. No node properties are mutated.

import { app } from "/scripts/app.js";

// =====================================================================
// State
// =====================================================================

let LIGHTHOUSE_ENABLED = false;
let SELECTED_NODE_ID = null;
let DISTANCE_MAP = new Map(); // nodeId -> integer distance from selected

// =====================================================================
// Distance-from-selected gradient
//
// Colour bands and a max distance after which everything is "far". Bands
// past index MAX_DEPTH all use the final colour at slightly reduced alpha.
// =====================================================================

const BANDS = [
    { color: "#ff5040", glow: "#ff8060", label: "1 — direct neighbour" },
    { color: "#ff9020", glow: "#ffb060", label: "2 hops" },
    { color: "#ffd840", glow: "#ffe890", label: "3 hops" },
    { color: "#50d050", glow: "#80e090", label: "4 hops" },
    { color: "#5090ff", glow: "#80b0ff", label: "5 hops" },
    { color: "#9070d0", glow: "#b090e0", label: "6+ hops" },
];

const SELECTED_RING_COLOR = "#ffffff";

// =====================================================================
// BFS from selected node, walking both input and output links.
// =====================================================================

function buildDistanceMap(graph, startNodeId) {
    const map = new Map();
    if (!graph || startNodeId == null) return map;
    map.set(startNodeId, 0);

    const queue = [startNodeId];
    while (queue.length > 0) {
        const id = queue.shift();
        const d = map.get(id);
        const node = graph.getNodeById(id);
        if (!node) continue;

        // Walk inputs (upstream connections).
        for (const inp of node.inputs || []) {
            const linkId = inp?.link;
            if (linkId == null) continue;
            const link = graph.links?.[linkId];
            if (!link) continue;
            const otherId = link.origin_id;
            if (otherId == null || map.has(otherId)) continue;
            map.set(otherId, d + 1);
            queue.push(otherId);
        }

        // Walk outputs (downstream connections).
        for (const out of node.outputs || []) {
            const links = out?.links || [];
            for (const linkId of links) {
                const link = graph.links?.[linkId];
                if (!link) continue;
                const otherId = link.target_id;
                if (otherId == null || map.has(otherId)) continue;
                map.set(otherId, d + 1);
                queue.push(otherId);
            }
        }
    }
    return map;
}

function bandForDistance(d) {
    if (d <= 0) return null;             // selected node — handled separately
    const idx = Math.min(d - 1, BANDS.length - 1);
    return BANDS[idx];
}

// =====================================================================
// Selection tracking
// =====================================================================

function refreshSelection() {
    if (!LIGHTHOUSE_ENABLED) return;
    const canvas = app?.canvas;
    if (!canvas) return;

    // ComfyUI keeps the most recent click target on canvas.current_node.
    // selected_nodes is a {id: node} map of all selected nodes; if the user
    // multi-selected, we just pick the first one as the lighthouse anchor.
    let target = canvas.current_node;
    if (!target && canvas.selected_nodes) {
        const ids = Object.keys(canvas.selected_nodes);
        if (ids.length > 0) target = canvas.selected_nodes[ids[0]];
    }

    const newId = target?.id ?? null;
    if (newId === SELECTED_NODE_ID && DISTANCE_MAP.size > 0) return;

    SELECTED_NODE_ID = newId;
    DISTANCE_MAP = newId != null ? buildDistanceMap(app.graph, newId) : new Map();
    canvas.setDirty(true, true);
}

function clearSelection() {
    if (SELECTED_NODE_ID == null && DISTANCE_MAP.size === 0) return;
    SELECTED_NODE_ID = null;
    DISTANCE_MAP = new Map();
    app?.canvas?.setDirty(true, true);
}

// =====================================================================
// Overlay rendering — extend LGraphCanvas.drawNode so we paint a
// coloured ring around each node after the default render.
// =====================================================================

let drawNodeWrapped = false;

function wrapDrawNode() {
    if (drawNodeWrapped) return;
    if (typeof LGraphCanvas === "undefined" || !LGraphCanvas.prototype?.drawNode) return;
    const orig = LGraphCanvas.prototype.drawNode;
    LGraphCanvas.prototype.drawNode = function (node, ctx) {
        const result = orig.call(this, node, ctx);
        if (LIGHTHOUSE_ENABLED) {
            try { paintLighthouseRing(node, ctx); } catch (e) { /* noop */ }
        }
        return result;
    };
    drawNodeWrapped = true;
}

function paintLighthouseRing(node, ctx) {
    if (!node || !node.size || !node.id) return;
    const d = DISTANCE_MAP.get(node.id);
    if (d === undefined) return; // not reachable from selected node

    const w = node.size[0];
    const h = node.size[1];
    // Account for the title bar that sits ABOVE the body (negative y).
    const titleH = LiteGraph?.NODE_TITLE_HEIGHT ?? 30;
    const x0 = -2;
    const y0 = -titleH - 2;
    const w0 = w + 4;
    const h0 = h + titleH + 4;

    if (d === 0) {
        // The selected node itself — bright white double-ring so it stands
        // out from the coloured bands. Doubled stroke widths to match the
        // beefier coloured halos.
        ctx.save();
        ctx.lineWidth = 8;
        ctx.strokeStyle = SELECTED_RING_COLOR;
        ctx.shadowColor = SELECTED_RING_COLOR;
        ctx.shadowBlur = 22;
        ctx.strokeRect(x0, y0, w0, h0);
        ctx.lineWidth = 3;
        ctx.shadowBlur = 0;
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.strokeRect(x0 - 5, y0 - 5, w0 + 10, h0 + 10);
        ctx.restore();
        return;
    }

    const band = bandForDistance(d);
    if (!band) return;

    ctx.save();
    // Outer glow halo — doubled stroke width so the colour reads at a glance.
    ctx.lineWidth = 6;
    ctx.shadowColor = band.glow;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = band.color;
    ctx.strokeRect(x0, y0, w0, h0);
    ctx.restore();
}

// =====================================================================
// Legend overlay — small fixed key in the bottom-left so the user knows
// which colour means which distance.
// =====================================================================

let drawForegroundWrapped = false;

function wrapDrawForeground() {
    if (drawForegroundWrapped) return;
    if (typeof LGraphCanvas === "undefined" || !LGraphCanvas.prototype) return;
    const proto = LGraphCanvas.prototype;
    const orig = proto.drawFrontCanvas || proto.drawForeground;
    if (!orig) return;
    const wrapName = proto.drawFrontCanvas ? "drawFrontCanvas" : "drawForeground";
    proto[wrapName] = function () {
        const result = orig.apply(this, arguments);
        if (LIGHTHOUSE_ENABLED) {
            try { paintLighthouseLegend(this); } catch (e) { /* noop */ }
        }
        return result;
    };
    drawForegroundWrapped = true;
}

function paintLighthouseLegend(canvas) {
    const ctx = canvas?.ctx;
    if (!ctx) return;
    const cw = canvas.canvas?.width ?? 0;
    const ch = canvas.canvas?.height ?? 0;
    if (!cw || !ch) return;

    const padX = 18;
    const padY = 18;
    const lineH = 18;
    const swatch = 12;
    const rows = SELECTED_NODE_ID != null
        ? [{ color: SELECTED_RING_COLOR, label: "selected" }, ...BANDS]
        : BANDS;

    const titleH = 22;
    const boxH = titleH + rows.length * lineH + padY;
    let boxW = 220;

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0); // ignore canvas pan/zoom
    ctx.font = "12px Arial";
    for (const r of rows) {
        const w = ctx.measureText(r.label || "").width + swatch + 24 + padX;
        if (w > boxW) boxW = w;
    }

    const x = padX;
    const y = ch - padY - boxH;

    // Background
    ctx.fillStyle = "rgba(20, 20, 22, 0.86)";
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1;
    ctx.fillRect(x, y, boxW, boxH);
    ctx.strokeRect(x + 0.5, y + 0.5, boxW - 1, boxH - 1);

    // Title
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px Arial";
    ctx.textBaseline = "top";
    const title = SELECTED_NODE_ID != null
        ? `Lighthouse — distance from node ${SELECTED_NODE_ID}`
        : "Lighthouse — click any node to highlight its neighbourhood";
    ctx.fillText(title, x + padX / 2, y + 6);

    // Rows
    ctx.font = "12px Arial";
    let ry = y + titleH + 4;
    for (const r of rows) {
        // Swatch
        ctx.fillStyle = r.color;
        ctx.fillRect(x + padX / 2, ry + (lineH - swatch) / 2, swatch, swatch);
        ctx.strokeStyle = "rgba(0,0,0,0.5)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + padX / 2 + 0.5, ry + (lineH - swatch) / 2 + 0.5, swatch - 1, swatch - 1);
        // Label
        ctx.fillStyle = "#ddd";
        ctx.fillText(r.label, x + padX / 2 + swatch + 8, ry + 3);
        ry += lineH;
    }
    ctx.restore();
}

// =====================================================================
// Selection event hooks — re-run BFS whenever the active selection changes.
// =====================================================================

let selectionWrapped = false;

function wrapSelectionEvents() {
    if (selectionWrapped) return;
    if (typeof LGraphCanvas === "undefined" || !LGraphCanvas.prototype) return;
    const proto = LGraphCanvas.prototype;

    // ComfyUI / LiteGraph fire onNodeSelected and onNodeDeselected on the
    // canvas instance. Wrap both so we re-build the distance map.
    const origOnSelected = proto.onNodeSelected;
    proto.onNodeSelected = function (node) {
        const r = origOnSelected ? origOnSelected.apply(this, arguments) : undefined;
        if (LIGHTHOUSE_ENABLED) refreshSelection();
        return r;
    };
    const origOnDeselected = proto.onNodeDeselected;
    proto.onNodeDeselected = function (node) {
        const r = origOnDeselected ? origOnDeselected.apply(this, arguments) : undefined;
        if (LIGHTHOUSE_ENABLED) {
            // Defer one tick — clicking another node fires deselect-then-select.
            setTimeout(refreshSelection, 0);
        }
        return r;
    };

    // Selection cleared by clicking empty canvas.
    const origOnSelectionChange = proto.onSelectionChange;
    proto.onSelectionChange = function () {
        const r = origOnSelectionChange ? origOnSelectionChange.apply(this, arguments) : undefined;
        if (LIGHTHOUSE_ENABLED) setTimeout(refreshSelection, 0);
        return r;
    };

    selectionWrapped = true;
}

// =====================================================================
// Toggle + menu integration
// =====================================================================

function setEnabled(on) {
    LIGHTHOUSE_ENABLED = !!on;
    if (LIGHTHOUSE_ENABLED) {
        wrapDrawNode();
        wrapDrawForeground();
        wrapSelectionEvents();
        refreshSelection();
    } else {
        clearSelection();
    }
    app?.canvas?.setDirty(true, true);
}

// Anchor the BFS on a specific node id, regardless of the current canvas
// selection. Used by the node-right-click "Anchor on this node" item so
// the user can highlight a node's neighbourhood without first selecting it.
function anchorOn(nodeId) {
    if (nodeId == null) return;
    if (!LIGHTHOUSE_ENABLED) setEnabled(true);
    SELECTED_NODE_ID = nodeId;
    DISTANCE_MAP = buildDistanceMap(app.graph, nodeId);
    app?.canvas?.setDirty(true, true);
}

app.registerExtension({
    name: "Lighthouse.GraphDistance",
    setup(app) {
        // Always wrap once so the toggle just gates the rendering. Wrapping
        // up-front avoids a noticeable hitch on first enable.
        wrapDrawNode();
        wrapDrawForeground();
        wrapSelectionEvents();

        // Empty-canvas right-click menu — toggle + manual refresh.
        const origCanvas = LGraphCanvas.prototype.getCanvasMenuOptions;
        LGraphCanvas.prototype.getCanvasMenuOptions = function () {
            const options = origCanvas.apply(this, arguments);
            options.push(null); // separator
            options.push({
                content: LIGHTHOUSE_ENABLED
                    ? "🔦 Lighthouse: ON  (click to disable)"
                    : "🔦 Lighthouse: OFF (click to enable)",
                callback: () => setEnabled(!LIGHTHOUSE_ENABLED),
            });
            options.push({
                content: "🔦 Lighthouse: Refresh from current selection",
                callback: () => { if (LIGHTHOUSE_ENABLED) refreshSelection(); },
            });
            return options;
        };

        // Node right-click menu — toggle + anchor-on-this-node. The same
        // toggle is mirrored here so the user can flip the mode without
        // having to navigate back to empty canvas first. The anchor item
        // skips the "first click + then refresh" two-step by running the
        // BFS straight away on whichever node was right-clicked.
        const origNode = LGraphCanvas.prototype.getNodeMenuOptions;
        LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
            const options = origNode.apply(this, arguments);
            options.push(null); // separator
            options.push({
                content: LIGHTHOUSE_ENABLED
                    ? "🔦 Lighthouse: ON  (click to disable)"
                    : "🔦 Lighthouse: OFF (click to enable)",
                callback: () => setEnabled(!LIGHTHOUSE_ENABLED),
            });
            options.push({
                content: "🔦 Lighthouse: Anchor on this node",
                callback: () => anchorOn(node?.id),
            });
            options.push({
                content: "🔦 Lighthouse: Refresh from current selection",
                callback: () => { if (LIGHTHOUSE_ENABLED) refreshSelection(); },
            });
            return options;
        };
    },
});
