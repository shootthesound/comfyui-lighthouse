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

// Focus slider position, 0..1.
//   0   = every band rendered at full opacity
//   1   = only the 1-hop band (red) is fully visible, the rest faded out
// Linear ramp between — see bandOpacity() below.
let FOCUS_LEVEL = 0;

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

// Per-band opacity given the current FOCUS_LEVEL.
//   threshold = (1 - FOCUS_LEVEL) * (BANDS.length - 1)
//   alpha     = clamp(1 - (idx - threshold), 0, 1)
// At FOCUS_LEVEL=0, threshold = N-1 → every band is fully on.
// At FOCUS_LEVEL=1, threshold = 0   → only band 0 (1-hop / red) is on,
//                                     band 1 fades to 0, etc.
function bandOpacityForIdx(idx) {
    if (FOCUS_LEVEL <= 0) return 1;
    const threshold = (1 - FOCUS_LEVEL) * (BANDS.length - 1);
    return Math.max(0, Math.min(1, 1 - (idx - threshold)));
}

function bandOpacityForDistance(d) {
    if (d <= 0) return 1; // selected node always full opacity
    const idx = Math.min(d - 1, BANDS.length - 1);
    return bandOpacityForIdx(idx);
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
    if (newId === SELECTED_NODE_ID && DISTANCE_MAP.size > 0) {
        updateLegendTitle();
        return;
    }

    SELECTED_NODE_ID = newId;
    DISTANCE_MAP = newId != null ? buildDistanceMap(app.graph, newId) : new Map();
    updateLegendTitle();
    canvas.setDirty(true, true);
}

function clearSelection() {
    if (SELECTED_NODE_ID == null && DISTANCE_MAP.size === 0) return;
    SELECTED_NODE_ID = null;
    DISTANCE_MAP = new Map();
    updateLegendTitle();
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
        // out from the coloured bands. Crisp strokes, no shadow blur.
        ctx.save();
        ctx.lineWidth = 8;
        ctx.strokeStyle = SELECTED_RING_COLOR;
        ctx.strokeRect(x0, y0, w0, h0);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.strokeRect(x0 - 5, y0 - 5, w0 + 10, h0 + 10);
        ctx.restore();
        return;
    }

    const band = bandForDistance(d);
    if (!band) return;

    const alpha = bandOpacityForDistance(d);

    // Coloured outline — fades to nothing as alpha drops, so faded nodes
    // don't have a bright distracting ring around them.
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 6;
    ctx.strokeStyle = band.color;
    ctx.strokeRect(x0, y0, w0, h0);
    ctx.restore();

    // Body darken proportional to how faded this band is.
    // alpha == 1 → no darkening; alpha == 0 → ~85% black wash on top
    // of the node body + title bar.
    if (alpha < 0.999) {
        const darken = (1 - alpha) * 0.85;
        ctx.save();
        ctx.fillStyle = `rgba(0, 0, 0, ${darken})`;
        ctx.fillRect(x0, y0, w0, h0);
        ctx.restore();
    }
}

// =====================================================================
// Floating HTML legend panel
//
// Anchored bottom-left of the viewport via position:fixed. Visible while
// LIGHTHOUSE_ENABLED is true, hidden otherwise. Updates its title line to
// either "click a node" prompt or "distance from node N" once a node is
// anchored. Lives entirely in the DOM so it sits on top of canvas + Vue
// overlays at all zoom levels.
// =====================================================================

let LEGEND_EL = null;
let LEGEND_TITLE_EL = null;
let LEGEND_BAND_SEGMENTS = []; // refs to coloured segments inside the bar (one per BAND)
let LEGEND_BAND_LABELS = [];   // refs to label rows alongside the bar (one per BAND)
let LEGEND_FOCUS_VALUE_EL = null;

function ensureLegend() {
    if (LEGEND_EL) return LEGEND_EL;
    const wrap = document.createElement("div");
    wrap.style.cssText = `
        position: fixed;
        left: 16px;
        bottom: 16px;
        z-index: 9000;
        background: rgba(20, 22, 26, 0.92);
        border: 1px solid rgba(255,255,255,0.14);
        border-radius: 10px;
        padding: 10px 12px 10px 12px;
        font-family: Arial, sans-serif;
        font-size: 12px;
        color: #ddd;
        box-shadow: 0 6px 18px rgba(0,0,0,0.45);
        display: none;
        user-select: none;
        pointer-events: auto;
        backdrop-filter: blur(6px);
        -webkit-backdrop-filter: blur(6px);
    `;

    const header = document.createElement("div");
    header.style.cssText = "display: flex; align-items: center; gap: 8px; margin-bottom: 8px;";

    const flame = document.createElement("span");
    flame.textContent = "🔦";
    flame.style.cssText = "font-size: 14px;";

    const title = document.createElement("span");
    title.style.cssText = "font-weight: bold; color: #fff; font-size: 12px;";
    title.textContent = "Lighthouse";
    LEGEND_TITLE_EL = title;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "×";
    closeBtn.title = "Turn Lighthouse off";
    closeBtn.style.cssText = `
        margin-left: auto;
        background: transparent;
        color: #aaa;
        border: none;
        font-size: 16px;
        line-height: 1;
        padding: 0 4px;
        cursor: pointer;
    `;
    closeBtn.addEventListener("click", () => setEnabled(false));

    header.appendChild(flame);
    header.appendChild(title);
    header.appendChild(closeBtn);
    wrap.appendChild(header);

    // Continuous colour bar — one tall strip showing the band sequence
    // top-to-bottom, with hop labels alongside each segment.
    const barWrap = document.createElement("div");
    barWrap.style.cssText = "display: flex; flex-direction: row; align-items: stretch; gap: 8px;";

    const bar = document.createElement("div");
    bar.style.cssText = `
        width: 14px;
        border-radius: 3px;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid rgba(0,0,0,0.45);
        flex: 0 0 auto;
    `;

    const labels = document.createElement("div");
    labels.style.cssText = "display: flex; flex-direction: column; gap: 0;";

    LEGEND_BAND_SEGMENTS = [];
    LEGEND_BAND_LABELS = [];

    // Selected-node row (always opaque, never affected by focus slider)
    {
        const seg = document.createElement("div");
        seg.style.cssText = `flex: 1 0 22px; background: ${SELECTED_RING_COLOR};`;
        bar.appendChild(seg);

        const labelRow = document.createElement("div");
        labelRow.style.cssText = `
            min-height: 22px; display: flex; align-items: center;
            font-size: 11px; color: #cfd2d6;
        `;
        labelRow.textContent = "selected node";
        labels.appendChild(labelRow);
    }

    for (const b of BANDS) {
        const seg = document.createElement("div");
        seg.style.cssText = `flex: 1 0 22px; background: ${b.color}; transition: opacity 80ms linear;`;
        bar.appendChild(seg);
        LEGEND_BAND_SEGMENTS.push(seg);

        const labelRow = document.createElement("div");
        labelRow.style.cssText = `
            min-height: 22px; display: flex; align-items: center;
            font-size: 11px; color: #cfd2d6; transition: opacity 80ms linear;
        `;
        labelRow.textContent = b.label;
        labels.appendChild(labelRow);
        LEGEND_BAND_LABELS.push(labelRow);
    }

    barWrap.appendChild(bar);
    barWrap.appendChild(labels);
    wrap.appendChild(barWrap);

    // --- Focus slider ---
    // Drag right to fade out the further bands. At max only the 1-hop
    // (red) band remains, so you can see one ring of neighbours at a time
    // around a complex node.
    const focusWrap = document.createElement("div");
    focusWrap.style.cssText = "margin-top: 10px; display: flex; flex-direction: column; gap: 4px;";

    const focusLabelRow = document.createElement("div");
    focusLabelRow.style.cssText = "font-size: 11px; color: #aaa; display: flex; justify-content: space-between;";
    const focusLabelLeft = document.createElement("span");
    focusLabelLeft.textContent = "Focus";
    const focusLabelRight = document.createElement("span");
    focusLabelRight.textContent = "all hops";
    LEGEND_FOCUS_VALUE_EL = focusLabelRight;
    focusLabelRow.appendChild(focusLabelLeft);
    focusLabelRow.appendChild(focusLabelRight);

    const focusSlider = document.createElement("input");
    focusSlider.type = "range";
    focusSlider.min = "0";
    focusSlider.max = "100";
    focusSlider.value = String(Math.round(FOCUS_LEVEL * 100));
    focusSlider.style.cssText = "width: 100%; margin: 0; accent-color: #ff5040; cursor: pointer;";
    focusSlider.addEventListener("input", (e) => {
        FOCUS_LEVEL = (parseFloat(e.target.value) || 0) / 100;
        applyFocusToLegend();
        app?.canvas?.setDirty(true, true);
    });

    focusWrap.appendChild(focusLabelRow);
    focusWrap.appendChild(focusSlider);
    wrap.appendChild(focusWrap);

    document.body.appendChild(wrap);
    LEGEND_EL = wrap;
    applyFocusToLegend();
    return wrap;
}

function applyFocusToLegend() {
    if (!LEGEND_BAND_SEGMENTS.length) return;
    let visibleBands = 0;
    for (let i = 0; i < BANDS.length; i++) {
        const a = bandOpacityForIdx(i);
        const seg = LEGEND_BAND_SEGMENTS[i];
        const lbl = LEGEND_BAND_LABELS[i];
        if (seg) seg.style.opacity = a;
        if (lbl) lbl.style.opacity = Math.max(0.25, a);
        if (a > 0.05) visibleBands++;
    }
    if (LEGEND_FOCUS_VALUE_EL) {
        LEGEND_FOCUS_VALUE_EL.textContent =
            visibleBands === BANDS.length ? "all hops" :
            visibleBands === 1            ? "1 hop only" :
                                            `~${visibleBands} hops`;
    }
}

function showLegend() {
    const el = ensureLegend();
    el.style.display = "block";
    updateLegendTitle();
}

function hideLegend() {
    if (LEGEND_EL) LEGEND_EL.style.display = "none";
}

function updateLegendTitle() {
    if (!LEGEND_TITLE_EL) return;
    if (SELECTED_NODE_ID != null) {
        const node = app?.graph?.getNodeById(SELECTED_NODE_ID);
        const niceName = node?.title || node?.type || `#${SELECTED_NODE_ID}`;
        LEGEND_TITLE_EL.textContent = `Lighthouse — anchored on ${niceName}`;
    } else {
        LEGEND_TITLE_EL.textContent = "Lighthouse — click any node";
    }
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
        wrapSelectionEvents();
        showLegend();
        refreshSelection();
    } else {
        clearSelection();
        hideLegend();
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
    updateLegendTitle();
    app?.canvas?.setDirty(true, true);
}

app.registerExtension({
    name: "Lighthouse.GraphDistance",
    setup(app) {
        // Always wrap once so the toggle just gates the rendering. Wrapping
        // up-front avoids a noticeable hitch on first enable.
        wrapDrawNode();
        wrapSelectionEvents();

        // Node right-click menu — only two items. Anchor turns Lighthouse
        // on (if it isn't already) and runs the BFS from this node. Off
        // turns the mode off and hides the floating legend panel.
        const origNode = LGraphCanvas.prototype.getNodeMenuOptions;
        LGraphCanvas.prototype.getNodeMenuOptions = function (node) {
            const options = origNode.apply(this, arguments);
            options.push(null); // separator
            options.push({
                content: "🔦 Lighthouse: Anchor from this node",
                callback: () => anchorOn(node?.id),
            });
            options.push({
                content: "🔦 Lighthouse: Off",
                callback: () => setEnabled(false),
            });
            return options;
        };
    },
});
