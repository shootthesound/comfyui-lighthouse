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

Right-click on the canvas and toggle **🔦 Lighthouse: ON**. Then click any node:

| Distance | Halo |
|---|---|
| 0 (the clicked node) | bright white double-ring |
| 1 hop (direct neighbours) | red |
| 2 hops | orange |
| 3 hops | yellow |
| 4 hops | green |
| 5 hops | blue |
| 6+ hops | violet |

A small legend appears in the bottom-left of the canvas while the mode is active. Toggle it off when you're done — the workflow returns to its normal appearance.

Works in both directions — Lighthouse walks both **upstream** (input links, what feeds this node) and **downstream** (output links, what consumes it).

---

### Right-click menu actions

The toggle is available **both on the empty canvas right-click menu and on any node's right-click menu** so you don't have to navigate away to flip the mode.

- **🔦 Lighthouse: ON / OFF** — toggle the mode (canvas + node menus).
- **🔦 Lighthouse: Anchor on this node** — *(node menu only)* run the BFS straight away from the right-clicked node, even if it isn't currently selected. Lights up the mode if it's off.
- **🔦 Lighthouse: Refresh from current selection** — re-run the BFS without changing selection. Useful after you've reconnected wires and want the halo refreshed.

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
