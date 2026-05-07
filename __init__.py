"""comfyui-lighthouse — at-a-glance graph-distance highlighting.

Click any node in your workflow and CleanFreak/Lighthouse highlights every
other node by how many connections away it is from the click target. The
direct neighbours glow red. One step further is orange. Then yellow, green,
blue, fading off.

It's a non-destructive visual overlay — no node properties are written, no
links are touched. The mode is toggleable from the canvas right-click menu.

This pack is JS-only; no backend nodes are registered. The Python file just
points ComfyUI at the web directory.
"""

WEB_DIRECTORY = "./web"

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
