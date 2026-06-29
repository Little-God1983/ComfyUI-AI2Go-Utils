# Resolution Selector node — part of ComfyUI-AI2Go-Utils.
#
# A standalone companion to the Ideogram 4 Prompt Builder. GPL-3.0, like the rest of the pack.
#
"""Resolution selector.

Computes a model-valid width/height from one of three modes and a target aspect ratio:

- raw        : type width/height directly (still snapped to the profile's multiple).
- auto       : pick an aspect ratio; edit either side and the other follows.
- megapixel  : pick a target megapixel count + aspect ratio; both sides are computed.

A *profile* selects the rules: the snap multiple and the min/max per side. For now the only
profile is "Ideogram 4" (multiple of 16, 256-2048 px per side). Outputs width/height as INT so it
plugs into any workflow; the editor JS adds an "Apply" button that pushes the dims straight into a
connected AI2Go Ideogram 4 Prompt Builder's canvas (and the dims also flow on graph execution).
"""

from comfy_api.latest import io

# Per-profile resolution rules: snap `mult`iple + `min`/`max` per side. Add entries here (and the
# matching copy in web/js/resolution_selector.js) to support more models.
PROFILES = {
    "Ideogram 4": {"mult": 16, "min": 256, "max": 2048},
}
DEFAULT_PROFILE = "Ideogram 4"

# Aspect presets as "W:H" strings (parsed by both this module and the editor JS); landscape → square → portrait.
ASPECT_PRESETS = ["1:1", "3:2", "4:3", "16:9", "16:10", "5:4", "2:1", "3:1",
                  "2:3", "3:4", "9:16", "10:16", "4:5", "1:2", "1:3"]


def _prof(name):
    return PROFILES.get(name, PROFILES[DEFAULT_PROFILE])


def _parse_ar(s):
    # "W:H" -> width/height ratio (float); 1.0 on anything malformed.
    try:
        a, b = str(s).split(":")
        a, b = float(a), float(b)
        return a / b if b else 1.0
    except Exception:
        return 1.0


def _snap(v, p):
    # Snap to the profile's multiple and clamp into [min, max].
    m = p["mult"]
    return int(min(p["max"], max(p["min"], round(v / m) * m)))


def _fit_w(tw, ar, p):
    # Largest width with aspect `ar` whose width AND height (=width/ar) both fit [min, max], with the
    # aspect ratio preserved — so hitting the per-side cap keeps the ratio (e.g. 16:9 -> 2048x1152, not
    # 2048x2048). Aspect is prioritized over hitting an exact target. Snapped to the profile multiple.
    lo, hi = p["min"], p["max"]
    wlo, whi = max(lo, lo * ar), min(hi, hi * ar)
    w = min(hi, max(lo, tw)) if wlo > whi else min(whi, max(wlo, tw))   # wlo>whi: aspect can't fit the range
    w = _snap(w, p)
    return w, _snap(w / ar, p)


def _resolve_dims(profile, mode, aspect, mp, width, height):
    # Mirror of the editor JS math so the INT outputs are correct even headless / via the API.
    p = _prof(profile)
    if mode == "raw":
        return _snap(width, p), _snap(height, p)  # raw: literal sides, snapped + per-axis clamped
    ar = _parse_ar(aspect)
    if mode == "megapixel":
        tw = (max(0.0, float(mp)) * 1_000_000.0 * ar) ** 0.5
    else:                                         # auto: width drives (JS keeps both sides consistent)
        tw = float(width)
    return _fit_w(tw, ar, p)                       # aspect preserved when clamped to the cap


class AI2GoResolutionSelector(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="AI2GoResolutionSelector",
            display_name="AI2Go Resolution Selector",
            category="AI2Go/image",
            search_aliases=["resolution", "aspect ratio", "megapixel", "ideogram", "width", "height", "size"],
            is_experimental=True,
            description="""
Pick a model-valid resolution by mode + aspect ratio, output width/height as INT.

- profile: the model ruleset (Ideogram 4 = multiples of 16, 256-2048 px per side).
- resolution_mode: 'raw' (type width/height), 'auto' (pick a ratio; edit one side, the other
  follows), or 'megapixel' (target megapixels + ratio; both computed).
- aspect_ratio / megapixels feed the auto and megapixel modes.

Wire width/height into the AI2Go Ideogram 4 Prompt Builder's width/height inputs; the node's
"Apply" button pushes the dims into the builder's canvas live (they also apply on execution).""",
            inputs=[
                io.Combo.Input("profile", options=list(PROFILES.keys()), default=DEFAULT_PROFILE,
                               tooltip="Model ruleset that governs the snap multiple and the min/max per side. "
                                       "Ideogram 4 = multiples of 16, 256-2048 px."),
                io.Combo.Input("resolution_mode", options=["raw", "auto", "megapixel"], default="raw",
                               tooltip="'raw' = type width/height; 'auto' = pick a ratio and edit either side; "
                                       "'megapixel' = pick a target megapixels + ratio. All snap to the profile."),
                io.Combo.Input("aspect_ratio", options=ASPECT_PRESETS, default="1:1",
                               tooltip="Target aspect ratio (W:H) for 'auto' and 'megapixel' modes."),
                io.Float.Input("megapixels", default=1.0, min=0.1, max=4.2, step=0.1,
                               tooltip="Target size in megapixels for 'megapixel' mode (Ideogram 4 caps ~4.19 MP at 2048x2048)."),
                io.Int.Input("width", default=1024, min=64, max=16384, step=8,
                             tooltip="Width. Editable in 'raw' and 'auto'; computed in 'megapixel'. Snapped to the profile multiple."),
                io.Int.Input("height", default=1024, min=64, max=16384, step=8,
                             tooltip="Height. Editable in 'raw' and 'auto'; computed in 'megapixel'. Snapped to the profile multiple."),
            ],
            outputs=[
                io.Int.Output(display_name="width"),
                io.Int.Output(display_name="height"),
            ],
        )

    @classmethod
    def execute(cls, profile=DEFAULT_PROFILE, resolution_mode="raw", aspect_ratio="1:1",
                megapixels=1.0, width=1024, height=1024) -> io.NodeOutput:
        w, h = _resolve_dims(profile, resolution_mode, aspect_ratio, megapixels, width, height)
        return io.NodeOutput(w, h)
