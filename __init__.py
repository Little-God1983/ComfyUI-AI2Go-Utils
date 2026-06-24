"""ComfyUI-AI2Go-Utils — a ComfyUI custom node pack by AIKnowledge2Go.

Node classes are registered in NODE_CLASS_MAPPINGS; their friendly labels in
NODE_DISPLAY_NAME_MAPPINGS. Front-end (JS) extensions live under ``web/`` and are
served to the ComfyUI frontend via WEB_DIRECTORY.
"""

# Register nodes here as they are added, e.g.:
#   from .nodes.ideogram4_nodes import Ideogram4PromptBuilderAI2Go
#   NODE_CLASS_MAPPINGS["Ideogram4PromptBuilderAI2Go"] = Ideogram4PromptBuilderAI2Go
#   NODE_DISPLAY_NAME_MAPPINGS["Ideogram4PromptBuilderAI2Go"] = "Ideogram 4 Prompt Builder (AI2Go)"
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

# Folder of front-end JavaScript served to the ComfyUI client.
WEB_DIRECTORY = "./web"

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
