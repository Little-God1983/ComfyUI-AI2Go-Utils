# Comfy-free resolution math for the AI2Go Resolution Selector — part of ComfyUI-AI2Go-Utils. GPL-3.0.
"""Pure resolution math, import-clean (no comfy_api) so it is unit-testable from the repo root.

The node class in resolution_selector.py imports from here, and the editor JS
(web/js/resolution_selector.js) mirrors this math so the readout and the INT outputs always agree.
"""
import re

# A profile whose `max` == BIG has no real per-side cap -> never shows the "clamped" warning.
BIG = 16384

# Per-profile rules. `mult` of None means "use the node's snap_multiple widget" (the `default`
# profile). Keep in sync with PROFILES in web/js/resolution_selector.js.
PROFILES = {
    "default":    {"mult": None, "min": 1,   "max": BIG},
    "Ideogram 4": {"mult": 16,   "min": 256, "max": 2048},
}
DEFAULT_PROFILE = "default"

# (ratio, name) — square + landscape only (W >= H). Portrait counterparts come from the flip
# button / `orientation`, so 1:1 is listed exactly once. Keep in sync with the JS ASPECT_PRESETS.
ASPECT_PRESETS = [
    ("1:1", "Square"),
    ("5:4", "Large Format"),
    ("4:3", "Standard"),
    ("3:2", "Photo"),
    ("16:10", "Monitor"),
    ("16:9", "Widescreen"),
    ("2:1", "Panorama"),
    ("21:9", "Cinemascope"),
    ("3:1", "Wide Panorama"),
]

_AR_RE = re.compile(r"\s*(\d+)\s*:\s*(\d+)")


def aspect_label(ratio, name):
    return f"{ratio} ({name})"


def aspect_options():
    return [aspect_label(r, n) for r, n in ASPECT_PRESETS]


def parse_ar(s):
    # Leading "W:H" from a bare ratio ("16:9") or a label ("16:9 (Widescreen)") -> width/height
    # float. 1.0 on anything malformed. Tolerates old saved values (bare ratios).
    m = _AR_RE.match(str(s))
    if not m:
        return 1.0
    a, b = float(m.group(1)), float(m.group(2))
    return a / b if b else 1.0


def effective_ar(aspect, orientation):
    # Presets are always landscape/square (W >= H); portrait inverts to H:W.
    ar = parse_ar(aspect)
    return (1.0 / ar) if (orientation == "portrait" and ar) else ar


def _prof(name):
    return PROFILES.get(name, PROFILES[DEFAULT_PROFILE])


def profile_clamps(name):
    # True when the profile has a real per-side cap (shows the "clamped to keep aspect" warning).
    return _prof(name)["max"] < BIG


def _rules(name, snap_multiple):
    # Effective {mult, min, max}. `default` reads its multiple from the widget; models use their own.
    p = _prof(name)
    mult = p["mult"] if p["mult"] else max(1, int(snap_multiple or 1))
    return {"mult": mult, "min": p["min"], "max": p["max"]}


def _snap(v, p):
    m = p["mult"]
    return int(min(p["max"], max(p["min"], round((float(v) if v else 0.0) / m) * m)))


def _fit_w(tw, ar, p):
    # Largest width with aspect `ar` whose width AND height both fit [min, max], aspect preserved —
    # so hitting the per-side cap keeps the ratio (16:9 -> 2048x1152, not 2048x2048).
    lo, hi = p["min"], p["max"]
    wlo, whi = max(lo, lo * ar), min(hi, hi * ar)
    w = min(hi, max(lo, tw)) if wlo > whi else min(whi, max(wlo, tw))
    w = _snap(w, p)
    return w, _snap(w / ar if ar else w, p)


def resolve_dims(profile, mode, aspect, orientation, snap_multiple, mp, width, height):
    # Mirror of the editor JS math so the INT outputs are correct even headless / via the API.
    p = _rules(profile, snap_multiple)
    if mode == "raw":
        return _snap(width, p), _snap(height, p)
    ar = effective_ar(aspect, orientation)
    if mode == "megapixel":
        tw = (max(0.0, float(mp)) * 1_000_000.0 * ar) ** 0.5
    else:                                    # auto: width drives (JS keeps both sides consistent)
        tw = float(width)
    return _fit_w(tw, ar, p)
