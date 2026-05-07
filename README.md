<h1 align="center">Lighthouse — for ComfyUI</h1>

<p align="center">
  Click any node and watch the rest of the workflow light up by graph distance.<br>
  Direct neighbours glow <span style="color:#ff5040"><strong>red</strong></span>. One step further: <span style="color:#ff9020"><strong>orange</strong></span>. Then <span style="color:#ffd840"><strong>yellow</strong></span>, <span style="color:#50d050"><strong>green</strong></span>, <span style="color:#5090ff"><strong>blue</strong></span>, fading off.
</p>

<p align="center">
  <a href="https://buymeacoffee.com/lorasandlenses"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee"></a>
</p>

---

### Why I built this

When a workflow grows past ~20 nodes you spend a lot of time mentally tracing wires to figure out what's actually feeding what. "If I tweak this CLIP encode, what does it ripple into? Which sampler is on the other end of this controlnet apply?" — that kind of question.

Lighthouse is a non-destructive overlay that answers it visually. Click the node you're curious about, and every other node lights up by how many connections away it is. The closer something is to the click target, the warmer its halo.

---

### What it does

Right-click any node and pick **🔦 Lighthouse: Anchor from current node**. The rest of the workflow lights up by graph distance from that node:

| Distance | Halo |
|---|---|
| 0 (the clicked node) | bright white double-ring |
| 1 hop (direct neighbours) | red |
| 2 hops | orange |
| 3 hops | yellow |
| 4 hops | green |
| 5 hops | blue |
| 6+ hops | violet |

A floating legend panel appears in the bottom-left of the viewport while the mode is active, with a colourbar and a header that reads "anchored on `<node title>`". Click the **×** in its corner (or the right-click menu's **Off** item) to dismiss — the workflow returns to its normal appearance.

Works in both directions — Lighthouse walks both **upstream** (input links, what feeds this node) and **downstream** (output links, what consumes it).

---

### Right-click menu actions

Two menu items, both on the **node** right-click menu (not the canvas menu):

- **🔦 Lighthouse: Anchor from current node** — runs the BFS straight away from the right-clicked node. Turns Lighthouse on if it was off.
- **🔦 Lighthouse: Off** — turns the mode off and hides the legend panel.

---

### How it works

Pure JS extension. When you click a node, Lighthouse runs a breadth-first search across `node.inputs[i].link` and `node.outputs[i].links[]` to build a `nodeId → distance` map. The overlay is then drawn by extending `LGraphCanvas.prototype.drawNode` to stroke a coloured ring around each node based on its distance.

**Nothing in the workflow is modified.** No `bgcolor`, no `color`, no link state, no node properties. The overlay is purely visual; turn the mode off and the canvas is identical to before.

---

### Quick start

1. Drop the `comfyui-lighthouse` folder into `ComfyUI/custom_nodes/`.
2. Restart ComfyUI (or reload the browser tab if hot-reloading is on).
3. Right-click empty canvas → **🔦 Lighthouse: ON**.
4. Click any node.

---

### Limitations / notes

- **Nodes not connected to the click target stay normal.** Lighthouse only highlights what's reachable in the graph. If a node looks unhighlighted, it has no path of links to your click target.
- **Bidirectional, not directional.** Distance counts hops in either direction. If you only want "downstream from here", that's a future toggle — open an issue if you want it.
- **Multi-select picks the first.** If you have several nodes selected, Lighthouse anchors on the first one. Click a single node to be unambiguous.

---

### Support

If this saves you wire-tracing time:

<a href="https://buymeacoffee.com/lorasandlenses"><img src="https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee"></a>
