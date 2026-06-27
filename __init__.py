"""ComfyUI-AI2Go-Utils — a ComfyUI custom node pack by AIKnowledge2Go.

Node classes are registered in NODE_CLASS_MAPPINGS; their friendly labels in
NODE_DISPLAY_NAME_MAPPINGS. Front-end (JS) extensions live under ``web/`` and are
served to the ComfyUI frontend via WEB_DIRECTORY.
"""

from .nodes.ideogram4_nodes import AI2GoIdeogram4PromptBuilder
from .nodes.ideogram4_style_wizard import AI2GoIdeogram4StyleWizard

# Key MUST match each node's schema node_id.
NODE_CLASS_MAPPINGS = {
    "AI2GoIdeogram4PromptBuilder": AI2GoIdeogram4PromptBuilder,
    "AI2GoIdeogram4StyleWizard": AI2GoIdeogram4StyleWizard,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "AI2GoIdeogram4PromptBuilder": "AI2Go Ideogram 4 Prompt Builder",
    "AI2GoIdeogram4StyleWizard": "AI2Go Ideogram 4 Style Wizard",
}

# Folder of front-end JavaScript served to the ComfyUI client.
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
