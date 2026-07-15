# Resolution Selector — Default Profile, Named Ratios & Orientation Flip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a pass-through `default` profile (the new default), a configurable snap multiple, human-named aspect ratios, 21:9/9:21 support, and a landscape⇄portrait flip button to the AI2Go Resolution Selector.

**Architecture:** Extract the comfy-free resolution math into a new import-clean module `nodes/resolution_core.py` (mirroring the existing `tracer.py` / `prompt_batch_core.py` pattern) so it is unit-testable without a ComfyUI install. The node class in `nodes/resolution_selector.py` imports from it and gains `snap_multiple` + `orientation` inputs. `web/js/resolution_selector.js` mirrors the same math and adds the flip button, snap-multiple visibility, an orientation-aware readout, and a backward-compat remap on load.

**Tech Stack:** Python 3.13 (ComfyUI `comfy_api.latest.io` schema), vanilla ES-module JS for the ComfyUI frontend, pytest for the comfy-free tests.

## Global Constraints

- **GPL-3.0** header comment style on new files, matching sibling files (`# … — part of ComfyUI-AI2Go-Utils. GPL-3.0.`).
- **Comfy-free logic lives in importable modules** — `nodes/resolution_core.py` must NOT `import comfy_api` (tests import it directly; ComfyUI/torch are not installed in the dev env).
- **Python ↔ JS parity:** `PROFILES`, `ASPECT_PRESETS`, and the snap/fit math must stay identical between `nodes/resolution_core.py` and `web/js/resolution_selector.js`.
- **Run pytest from the repo root:** `python -m pytest -q` (the `--confcutdir=tests` in `pyproject.toml` requires it).
- **Validate `web/js/*.js` as ES modules**, never `node --check foo.js` (it false-passes module-only syntax errors). Use the harness in Task 3.
- **Aspect list is square + landscape only** (`W ≥ H`); portrait ratios come from `orientation`/the flip button. `1:1` appears exactly once.
- **`BIG = 16384`** is the "no real cap" sentinel: a profile whose `max` equals `BIG` never shows the clamp warning.

---

### Task 1: Comfy-free resolution core module

**Files:**
- Create: `nodes/resolution_core.py`
- Test: `tests/test_resolution_core.py`

**Interfaces:**
- Consumes: nothing (pure stdlib).
- Produces (imported by Task 2 and the tests):
  - `PROFILES: dict[str, dict]`, `DEFAULT_PROFILE: str = "default"`
  - `ASPECT_PRESETS: list[tuple[str, str]]` — `(ratio, name)`, square + landscape only
  - `aspect_label(ratio: str, name: str) -> str` → `"16:9 (Widescreen)"`
  - `aspect_options() -> list[str]` — labels for the Combo, in preset order
  - `parse_ar(s: str) -> float` — leading `W:H` from a bare ratio OR a label
  - `effective_ar(aspect: str, orientation: str) -> float`
  - `profile_clamps(name: str) -> bool`
  - `resolve_dims(profile, mode, aspect, orientation, snap_multiple, mp, width, height) -> tuple[int,int]`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_resolution_core.py`:

```python
# Tests for the comfy-free resolution core — part of ComfyUI-AI2Go-Utils. GPL-3.0.
from nodes.resolution_core import (
    resolve_dims, effective_ar, parse_ar, profile_clamps, aspect_options,
)

SQ = "1:1 (Square)"
WS = "16:9 (Widescreen)"


def test_default_profile_never_clamps():
    assert resolve_dims("default", "raw", SQ, "landscape", 8, 1.0, 5000, 5000) == (5000, 5000)


def test_snap_multiple_rounds_to_8():
    # 1021/8 = 127.625 -> 128 -> 1024 ; 1000 already a multiple of 8
    assert resolve_dims("default", "raw", SQ, "landscape", 8, 1.0, 1021, 1000) == (1024, 1000)


def test_snap_multiple_is_configurable():
    # 1030/64 = 16.09 -> 16 -> 1024
    assert resolve_dims("default", "raw", SQ, "landscape", 64, 1.0, 1030, 1030) == (1024, 1024)


def test_ideogram_ignores_snap_multiple():
    # snap_multiple=64 is ignored; Ideogram stays mult 16: 1050/16 = 65.625 -> 66 -> 1056
    assert resolve_dims("Ideogram 4", "raw", SQ, "landscape", 64, 1.0, 1050, 1050) == (1056, 1056)


def test_default_uses_snap_multiple_not_model_mult():
    # same input as above but default profile + mult 64 -> 1024, proving the two profiles differ
    assert resolve_dims("default", "raw", SQ, "landscape", 64, 1.0, 1050, 1050) == (1024, 1024)


def test_ideogram_clamps_16_9_keeping_aspect():
    assert resolve_dims("Ideogram 4", "auto", WS, "landscape", 8, 1.0, 4000, 0) == (2048, 1152)


def test_orientation_transpose_portrait_is_taller():
    w, h = resolve_dims("default", "auto", WS, "portrait", 8, 1.0, 1080, 0)
    assert h > w and (w, h) == (1080, 1920)


def test_orientation_landscape_is_wider():
    w, h = resolve_dims("default", "auto", WS, "landscape", 8, 1.0, 1920, 0)
    assert w > h and (w, h) == (1920, 1080)


def test_effective_ar_inverts_for_portrait():
    assert round(effective_ar(WS, "landscape"), 4) == round(16 / 9, 4)
    assert round(effective_ar(WS, "portrait"), 4) == round(9 / 16, 4)


def test_backward_compat_bare_ratio_matches_label():
    bare = resolve_dims("default", "auto", "16:9", "landscape", 8, 1.0, 1920, 0)
    label = resolve_dims("default", "auto", WS, "landscape", 8, 1.0, 1920, 0)
    assert bare == label == (1920, 1080)
    assert parse_ar("16:9") == parse_ar(WS)


def test_new_21_9_ratio():
    # 21:9 ; 2016 is a multiple of 8 and 2016*9/21 = 864 (also /8) -> no rounding ambiguity
    assert resolve_dims("default", "auto", "21:9 (Cinemascope)", "landscape", 8, 1.0, 2016, 0) == (2016, 864)


def test_profile_clamps_flag():
    assert profile_clamps("Ideogram 4") is True
    assert profile_clamps("default") is False


def test_aspect_options_shape():
    opts = aspect_options()
    assert opts[0] == "1:1 (Square)"
    assert "16:9 (Widescreen)" in opts
    assert "21:9 (Cinemascope)" in opts
    assert len(opts) == 9
    # square + landscape only — no portrait ratios listed
    assert not any(lbl.startswith(("9:16", "2:3", "3:4", "4:5", "1:2", "9:21", "1:3")) for lbl in opts)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_resolution_core.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'nodes.resolution_core'`.

- [ ] **Step 3: Write the implementation**

Create `nodes/resolution_core.py`:

```python
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_resolution_core.py -q`
Expected: PASS — 13 passed.

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `python -m pytest -q`
Expected: PASS — previous 42 passed + 13 new = 55 passed, 1 skipped.

- [ ] **Step 6: Commit**

```bash
git add nodes/resolution_core.py tests/test_resolution_core.py
git commit -m "feat: comfy-free resolution core (default profile, snap multiple, orientation, named ratios)"
```

---

### Task 2: Wire the node to the core + new inputs

**Files:**
- Modify: `nodes/resolution_selector.py` (full rewrite of the node module — the math now lives in `resolution_core`)

**Interfaces:**
- Consumes: everything from `nodes.resolution_core` (Task 1).
- Produces: the `AI2GoResolutionSelector` node with inputs `profile, snap_multiple, resolution_mode, aspect_ratio, orientation, megapixels, width, height` and INT outputs `width, height`. The JS (Task 3) relies on the widget names `snap_multiple` and `orientation`.

- [ ] **Step 1: Rewrite `nodes/resolution_selector.py`**

Replace the entire file with:

```python
# Resolution Selector node — part of ComfyUI-AI2Go-Utils.
#
# A standalone companion to the Ideogram 4 Prompt Builder. GPL-3.0, like the rest of the pack.
#
"""Resolution selector.

Computes a valid width/height from one of three modes and a target aspect ratio:

- raw        : type width/height directly (snapped to the profile's / snap_multiple's multiple).
- auto       : pick an aspect ratio; edit either side and the other follows.
- megapixel  : pick a target megapixel count + aspect ratio; both sides are computed.

A *profile* selects the rules. "default" does no model clamping (its snap multiple is the
`snap_multiple` widget, default 8). "Ideogram 4" snaps to 16 and clamps 256-2048 px per side.
A landscape-only aspect list + an `orientation` toggle (driven by the JS flip button) cover both
orientations without duplicate entries. All math lives in resolution_core so it is unit-testable
without ComfyUI, and the editor JS mirrors it.
"""

from comfy_api.latest import io

from .resolution_core import (
    ASPECT_PRESETS, DEFAULT_PROFILE, PROFILES, aspect_label, aspect_options, resolve_dims,
)

_DEFAULT_ASPECT = aspect_label(*ASPECT_PRESETS[0])   # "1:1 (Square)"


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
Pick a valid resolution by mode + aspect ratio, output width/height as INT.

- profile: 'default' (no clamp; snaps to the 'snap_multiple' field) or a model ruleset like
  'Ideogram 4' (multiples of 16, 256-2048 px per side).
- resolution_mode: 'raw' (type width/height), 'auto' (pick a ratio; edit one side, the other
  follows), or 'megapixel' (target megapixels + ratio; both computed).
- aspect_ratio lists square + landscape ratios; the '⟷' flip button (orientation) makes the
  portrait versions. megapixels feeds the megapixel mode.

Wire width/height into the AI2Go Ideogram 4 Prompt Builder's width/height inputs; edits push into
the builder's canvas live (they also apply on execution).""",
            inputs=[
                io.Combo.Input("profile", options=list(PROFILES.keys()), default=DEFAULT_PROFILE,
                               tooltip="Model ruleset. 'default' = no clamp, snaps to 'snap_multiple'. "
                                       "'Ideogram 4' = multiples of 16, 256-2048 px."),
                io.Int.Input("snap_multiple", default=8, min=1, max=1024, step=1,
                             tooltip="Round each side to a multiple of this. Most diffusion models require "
                                     "multiples of 8, so keep it at 8 unless your model needs otherwise. "
                                     "Ignored by model profiles that define their own multiple (Ideogram 4 = 16)."),
                io.Combo.Input("resolution_mode", options=["raw", "auto", "megapixel"], default="raw",
                               tooltip="'raw' = type width/height; 'auto' = pick a ratio and edit either side; "
                                       "'megapixel' = pick a target megapixels + ratio. All snap to the profile."),
                io.Combo.Input("aspect_ratio", options=aspect_options(), default=_DEFAULT_ASPECT,
                               tooltip="Target aspect ratio for 'auto' and 'megapixel'. Square + landscape only; "
                                       "use the flip button (orientation) for portrait."),
                io.Combo.Input("orientation", options=["landscape", "portrait"], default="landscape",
                               tooltip="Landscape or portrait. Toggled by the '⟷' flip button in the editor; "
                                       "portrait transposes the selected ratio (16:9 -> 9:16)."),
                io.Float.Input("megapixels", default=1.0, min=0.1, max=16.0, step=0.1,
                               tooltip="Target size in megapixels for 'megapixel' mode. (Ideogram 4 still clamps "
                                       "to ~4.19 MP at 2048x2048.)"),
                io.Int.Input("width", default=1024, min=64, max=16384, step=8,
                             tooltip="Width. Editable in 'raw' and 'auto'; computed in 'megapixel'. Snapped to the multiple."),
                io.Int.Input("height", default=1024, min=64, max=16384, step=8,
                             tooltip="Height. Editable in 'raw' and 'auto'; computed in 'megapixel'. Snapped to the multiple."),
            ],
            outputs=[
                io.Int.Output(display_name="width"),
                io.Int.Output(display_name="height"),
            ],
        )

    @classmethod
    def execute(cls, profile=DEFAULT_PROFILE, snap_multiple=8, resolution_mode="raw",
                aspect_ratio=_DEFAULT_ASPECT, orientation="landscape", megapixels=1.0,
                width=1024, height=1024) -> io.NodeOutput:
        w, h = resolve_dims(profile, resolution_mode, aspect_ratio, orientation,
                            snap_multiple, megapixels, width, height)
        return io.NodeOutput(w, h)
```

- [ ] **Step 2: Syntax-check the module**

Run: `python -m py_compile nodes/resolution_selector.py && echo OK`
Expected: `OK` (a bare `import` of the module fails without ComfyUI installed — that is expected; `py_compile` confirms the syntax).

- [ ] **Step 3: Confirm the core tests + full suite still pass**

Run: `python -m pytest -q`
Expected: PASS — 55 passed, 1 skipped (Task 2 changed no comfy-free logic; this guards against an accidental core edit).

- [ ] **Step 4: Commit**

```bash
git add nodes/resolution_selector.py
git commit -m "feat: add snap_multiple + orientation inputs, default profile, named ratios to resolution node"
```

**Note for the reviewer / user:** the node class imports `comfy_api`, so it cannot be imported in the dev env — a live check (restart ComfyUI server, confirm the node loads with the new default profile and dropdown) is deferred to the user per the project's testing convention.

---

### Task 3: Editor JS — flip button, visibility, orientation-aware readout

**Files:**
- Modify: `web/js/resolution_selector.js` (substantial rewrite: mirror the new core, add the flip button + snap-multiple visibility + orientation readout + backward-compat remap)

**Interfaces:**
- Consumes: widget names from Task 2 (`profile`, `snap_multiple`, `resolution_mode`, `aspect_ratio`, `orientation`, `megapixels`, `width`, `height`).
- Produces: no exports (registers a ComfyUI extension).

- [ ] **Step 1: Replace `web/js/resolution_selector.js`**

Replace the entire file with:

```javascript
/*
 * Part of ComfyUI-AI2Go-Utils.
 *
 * Front-end for the AI2Go Resolution Selector node. GPL-3.0, like the rest of the pack.
 *
 * Three modes (raw / auto / megapixel) compute a profile-valid width/height. The math mirrors
 * nodes/resolution_core.py so the readout/UI and the INT outputs always agree. A landscape-only
 * aspect list + a "⟷" flip button (orientation) cover both orientations without duplicate entries.
 * Edits auto-push the dims into any connected node's width/height widgets and fire their callbacks —
 * which, for the AI2Go Ideogram 4 Prompt Builder, refreshes its editor canvas.
 */
import { chainCallback } from "./utility.js";
const { app } = window.comfyAPI.app;

// A profile whose max == BIG has no real cap -> never shows the "clamped" warning.
const BIG = 16384;
// Keep in sync with PROFILES in nodes/resolution_core.py. mult null = use the snap_multiple widget.
const PROFILES = {
  "default":    { mult: null, min: 1,   max: BIG },
  "Ideogram 4": { mult: 16,   min: 256, max: 2048 },
};
const DEFAULT_PROFILE = "default";

// (ratio, name) — square + landscape only. Keep in sync with ASPECT_PRESETS in resolution_core.py.
const ASPECT_PRESETS = [
  ["1:1", "Square"], ["5:4", "Large Format"], ["4:3", "Standard"], ["3:2", "Photo"],
  ["16:10", "Monitor"], ["16:9", "Widescreen"], ["2:1", "Panorama"], ["21:9", "Cinemascope"],
  ["3:1", "Wide Panorama"],
];
const aspectLabel = (r, n) => `${r} (${n})`;

const parseAR = (s) => { const m = /(\d+)\s*:\s*(\d+)/.exec(String(s || "")); return m ? (+m[1]) / (+m[2]) : 1; };
const effAR = (aspect, orient) => { const ar = parseAR(aspect); return (orient === "portrait" && ar) ? 1 / ar : ar; };
const profClamps = (name) => (PROFILES[name] || PROFILES[DEFAULT_PROFILE]).max < BIG;
function effRules(name, snapMult) {
  const p = PROFILES[name] || PROFILES[DEFAULT_PROFILE];
  const mult = p.mult ? p.mult : Math.max(1, parseInt(snapMult, 10) || 1);
  return { mult, min: p.min, max: p.max };
}
const snap = (v, p) => Math.min(p.max, Math.max(p.min, Math.round((Number(v) || 0) / p.mult) * p.mult));
function fitW(tw, ar, p) {
  const wlo = Math.max(p.min, p.min * ar), whi = Math.min(p.max, p.max * ar);
  const w = snap(wlo > whi ? Math.min(p.max, Math.max(p.min, tw)) : Math.min(whi, Math.max(wlo, tw)), p);
  return [w, snap(ar ? w / ar : w, p)];
}

app.registerExtension({
  name: "AI2Go.ResolutionSelector",

  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "AI2GoResolutionSelector") return;

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const node = this;
      const findW = (n) => node.widgets?.find((w) => w.name === n);
      const profileWidget = findW("profile");
      const snapWidget = findW("snap_multiple");
      const modeWidget = findW("resolution_mode");
      const arWidget = findW("aspect_ratio");
      const orientWidget = findW("orientation");
      const mpWidget = findW("megapixels");
      const wWidget = findW("width");
      const hWidget = findW("height");

      const resMode = () => (modeWidget ? modeWidget.value : "raw");
      const profName = () => profileWidget?.value || DEFAULT_PROFILE;
      const orient = () => (orientWidget?.value === "portrait" ? "portrait" : "landscape");
      const currentDims = () => ({ w: parseInt(wWidget?.value, 10) || 0, h: parseInt(hWidget?.value, 10) || 0 });

      // Toggle a native widget's visibility while keeping it serializable (the proven prompt-builder
      // trick): saved computeSize is restored on show, [0,-4] collapses it on hide.
      function setWidgetVisible(w, vis) {
        if (!w) return;
        if (!vis) {
          if (!w._resHidden) { w._resPrevCompute = w.computeSize; w._resHidden = true; }
          w.hidden = true;
          w.computeSize = () => [0, -4];
        } else if (w._resHidden) {
          w.hidden = false;
          w.computeSize = w._resPrevCompute;
          w._resHidden = false;
        }
      }

      // Recompute width/height for the active mode, snapping/clamping to the profile. `driver` is the
      // side the user just edited in auto mode ("w"|"h"). Re-entrancy guarded.
      function recalcDims(driver) {
        if (node._resCalc || !wWidget || !hWidget) return;
        const mode = resMode(), p = effRules(profName(), snapWidget?.value), clamps = profClamps(profName());
        node._resCalc = true;
        let warn = false;
        try {
          if (mode === "raw") {                     // raw: literal sides, snapped + per-axis clamped
            const w = Number(wWidget.value) || 0, h = Number(hWidget.value) || 0;
            warn = clamps && (w > p.max || h > p.max);
            wWidget.value = snap(w, p);
            hWidget.value = snap(h, p);
          } else {                                  // auto / megapixel: aspect-locked, ratio preserved at cap
            const ar = effAR(arWidget?.value, orient());
            let tw;
            if (mode === "megapixel") tw = Math.sqrt(Math.max(0, parseFloat(mpWidget?.value) || 0) * 1e6 * ar);
            else if (driver === "h") tw = (Number(hWidget.value) || 0) * ar;   // auto, height edited
            else tw = Number(wWidget.value) || 0;                              // auto, width edited / ratio change
            warn = clamps && (tw > p.max || (ar ? tw / ar : 0) > p.max);       // ideal side exceeds the cap
            const [w, h] = fitW(tw, ar, p);
            wWidget.value = w;
            hWidget.value = h;
          }
        } finally { node._resCalc = false; node._resWarn = warn; }
      }

      function updateReadout() {
        if (!resLine) return;
        const d = currentDims(), p = effRules(profName(), snapWidget?.value);
        const mp = (d.w * d.h / 1e6).toFixed(2);
        let suffix = "";
        if (resMode() !== "raw") {                  // show the effective ratio + orientation
          const m = /(\d+)\s*:\s*(\d+)/.exec(arWidget?.value || "");
          if (m) {
            const a = +m[1], b = +m[2];
            if (a === b) suffix = `    ·    ${a}:${b} Square`;
            else if (orient() === "portrait") suffix = `    ·    ${b}:${a} Portrait`;
            else suffix = `    ·    ${a}:${b} Landscape`;
          }
        }
        resLine.textContent = `${d.w} × ${d.h}    ${mp} MP${suffix}`;
        if (node._resWarn) {
          warnLine.textContent = `⚠ ${profName()} max ${p.max} × ${p.max} px — clamped to keep aspect`;
          warnLine.style.display = "";
        } else {
          warnLine.style.display = "none";
        }
      }

      // Show/hide the mode-relevant widgets (snap_multiple only for the default profile; orientation
      // is always hidden — driven by the flip button), then relayout the node.
      function applyVisibility() {
        const mode = resMode();
        setWidgetVisible(arWidget, mode !== "raw");
        setWidgetVisible(mpWidget, mode === "megapixel");
        setWidgetVisible(wWidget, mode !== "megapixel");
        setWidgetVisible(hWidget, mode !== "megapixel");
        setWidgetVisible(snapWidget, profName() === DEFAULT_PROFILE);
        setWidgetVisible(orientWidget, false);
        if (node.computeSize) node.setSize([node.size[0], node.computeSize()[1]]);
        node.setDirtyCanvas?.(true, true);
      }

      // Push the current dims into every node wired to the width/height outputs (slot 0 = width,
      // 1 = height). Returns the number of target nodes touched.
      function pushToTargets() {
        if (!node.graph) return 0;
        const d = currentDims();
        const links = node.graph.links;
        const getLink = (id) => (links?.get ? links.get(id) : links?.[id]);
        const touched = new Set();
        (node.outputs || []).forEach((out, slot) => {
          const val = slot === 1 ? d.h : d.w;
          for (const id of (out.links || [])) {
            const link = getLink(id);
            if (!link) continue;
            const tgt = node.graph.getNodeById(link.target_id);
            if (!tgt) continue;
            const inp = tgt.inputs?.[link.target_slot];
            const tw = inp && tgt.widgets?.find((x) => x.name === inp.name);
            if (tw) { tw.value = val; tw.callback?.(val); }
            touched.add(tgt);
          }
        });
        for (const t of touched) t.setDirtyCanvas?.(true, true);
        return touched.size;
      }

      // Recompute + relabel; optionally push live to connected canvases.
      function refresh(driver, push) {
        recalcDims(driver);
        updateReadout();
        if (push) pushToTargets();
        node.setDirtyCanvas?.(true, true);
      }

      const flipLabel = () => `⟷ Orientation: ${orient() === "portrait" ? "Portrait" : "Landscape"}`;
      // Flip toggles orientation AND swaps the current width/height, then recomputes. In raw mode
      // (no aspect) the swap alone rotates the size; in auto/megapixel the inverted ratio drives it.
      function doFlip() {
        if (orientWidget) orientWidget.value = orient() === "portrait" ? "landscape" : "portrait";
        if (wWidget && hWidget) { const t = wWidget.value; wWidget.value = hWidget.value; hWidget.value = t; }
        if (flipBtn) flipBtn.name = flipLabel();
        refresh("w", true);
      }

      // On load, remap an old/bare aspect value ("16:9", or an old portrait "9:16") to a current
      // landscape label + orientation, so pre-change workflows don't reset to the default.
      function remapAspectOnLoad() {
        if (!arWidget) return;
        const opts = arWidget.options?.values || [];
        const v = String(arWidget.value ?? "");
        if (!opts.includes(v)) {
          const m = /(\d+)\s*:\s*(\d+)/.exec(v);
          if (m) {
            let a = +m[1], b = +m[2], portrait = false;
            if (a < b) { const t = a; a = b; b = t; portrait = true; }   // old portrait -> landscape base
            const preset = ASPECT_PRESETS.find(([r]) => r === `${a}:${b}`);
            if (preset) {
              arWidget.value = aspectLabel(preset[0], preset[1]);
              if (portrait && orientWidget) orientWidget.value = "portrait";
            }
          }
        }
        if (flipBtn) flipBtn.name = flipLabel();
      }

      // ── Read-only output readout (added last → sits under the flip button). ──
      const readoutEl = document.createElement("div");
      readoutEl.style.cssText = "width:100%;box-sizing:border-box;padding:2px 4px;text-align:center;line-height:1.45;";
      const resLine = document.createElement("div");
      resLine.style.cssText = "font:bold 13px monospace;color:#46b4e6;";
      const warnLine = document.createElement("div");
      warnLine.style.cssText = "color:#e0a020;font:10px sans-serif;display:none;";
      readoutEl.append(resLine, warnLine);

      // ── flip button (native, non-serialized) then the readout DOM widget ──
      const flipBtn = node.addWidget("button", flipLabel(), null, doFlip, { serialize: false });
      node.addDOMWidget("output_resolution", "info", readoutEl, { serialize: false });

      // ── wire widget callbacks (auto-push live so a connected canvas tracks edits) ──
      if (profileWidget) chainCallback(profileWidget, "callback", () => { applyVisibility(); refresh("w", true); });
      if (snapWidget) chainCallback(snapWidget, "callback", () => refresh("w", true));
      if (modeWidget) chainCallback(modeWidget, "callback", () => { applyVisibility(); refresh("w", true); });
      if (arWidget) chainCallback(arWidget, "callback", () => { if (resMode() !== "raw") refresh("w", true); });
      if (mpWidget) chainCallback(mpWidget, "callback", () => { if (resMode() === "megapixel") refresh(undefined, true); });
      if (wWidget) chainCallback(wWidget, "callback", () => { if (!node._resCalc) refresh("w", true); });
      if (hWidget) chainCallback(hWidget, "callback", () => { if (!node._resCalc) refresh("h", true); });

      // Push to a freshly-connected downstream node so its canvas reflects right away.
      chainCallback(node, "onConnectionsChange", function () { requestAnimationFrame(() => pushToTargets()); });

      // Apply the current state (remap on load + visibility + recompute + readout). Reused by onConfigure.
      node._resApply = () => { remapAspectOnLoad(); applyVisibility(); recalcDims("w"); updateReadout(); };
      requestAnimationFrame(node._resApply);
    });

    // Re-apply after a saved workflow loads (widget values restored first).
    chainCallback(nodeType.prototype, "onConfigure", function () {
      const node = this;
      requestAnimationFrame(() => { node._resApply?.(); });
    });
  },
});
```

- [ ] **Step 2: Write the ESM validation harness**

Create `C:\Users\LITTLE~1\AppData\Local\Temp\claude\e--Repos-ComfyUI-AI2Go-Utils\b606184a-7d69-4d18-9afa-8a51d1fc1b31\scratchpad\check_res_js.mjs`:

```javascript
// ESM parse + registration harness for web/js/resolution_selector.js (node --check false-passes ESM).
import { pathToFileURL } from "node:url";

// Minimal mocks: capture the registered extension, fake the widgets the node reads.
const captured = {};
globalThis.window = { comfyAPI: { app: { app: { registerExtension: (e) => { captured.ext = e; } } } } };
globalThis.document = { createElement: () => ({ style: {}, append() {} }) };
globalThis.requestAnimationFrame = (fn) => fn();

const url = pathToFileURL("e:/Repos/ComfyUI-AI2Go-Utils/web/js/resolution_selector.js").href;
await import(url);
if (!captured.ext) throw new Error("registerExtension was not called — module failed to register");

// Drive beforeRegisterNodeDef + onNodeCreated with a fake node carrying the schema widgets.
const proto = {};
const chained = {};
const mkWidget = (name, value) => ({ name, value, options: { values: [] }, computeSize: () => [0, 20] });
const nodeType = { prototype: proto };
await captured.ext.beforeRegisterNodeDef(nodeType, { name: "AI2GoResolutionSelector" });

const node = {
  widgets: [
    mkWidget("profile", "default"), mkWidget("snap_multiple", 8), mkWidget("resolution_mode", "raw"),
    mkWidget("aspect_ratio", "1:1 (Square)"), mkWidget("orientation", "landscape"),
    mkWidget("megapixels", 1.0), mkWidget("width", 1024), mkWidget("height", 1024),
  ],
  size: [200, 100],
  addWidget: (t, label, v, cb) => { const w = { name: label, callback: cb }; node.widgets.push(w); return w; },
  addDOMWidget: () => ({}),
  computeSize: () => [200, 100], setSize() {}, setDirtyCanvas() {},
};
proto.onNodeCreated.call(node);
console.log("OK: module parses, registers, and onNodeCreated runs. widgets:", node.widgets.map((w) => w.name).join(","));
```

- [ ] **Step 3: Run the harness**

Run: `node "C:\Users\LITTLE~1\AppData\Local\Temp\claude\e--Repos-ComfyUI-AI2Go-Utils\b606184a-7d69-4d18-9afa-8a51d1fc1b31\scratchpad\check_res_js.mjs"`
Expected: `OK: module parses, registers, and onNodeCreated runs. widgets: profile,snap_multiple,resolution_mode,aspect_ratio,orientation,megapixels,width,height,⟷ Orientation: Landscape`
(If it throws a parse error or "registerExtension was not called", fix the JS and re-run — do NOT rely on `node --check`.)

- [ ] **Step 4: Commit**

```bash
git add web/js/resolution_selector.js
git commit -m "feat: flip button, snap-multiple visibility, orientation readout in resolution selector JS"
```

**Note for the user:** the harness confirms the module parses/registers headlessly, but the live browser behavior (flip button rotates dims, snap_multiple shows only for the default profile, readout shows orientation) is deferred to a hard refresh in ComfyUI per the project's testing convention.

---

### Task 4: Update the README

**Files:**
- Modify: `README.md` — add an `### AI2Go Resolution Selector` section under `## Nodes` (currently the node is only named in Credits).

**Interfaces:** none (docs).

- [ ] **Step 1: Add the section**

Insert a new section after the `### AI2Go Prompt Batch` section (before `### AI2Go Save Metadata (Civitai)`, around `README.md:189`):

```markdown
### AI2Go Resolution Selector

Pick a model-valid **width/height** by aspect ratio and mode, and (optionally) push it straight into
a connected **Ideogram 4 Prompt Builder**.

- **Profiles** — `default` does no clamping (it just snaps each side to the **`snap_multiple`** field,
  default **8**, which is what most diffusion samplers require). Model profiles like **Ideogram 4**
  enforce their own rules (multiples of 16, 256–2048 px) and show a *"clamped to keep aspect"* warning
  when a request exceeds the cap. `default` is the default so the node is safe to drop into any
  workflow.
- **Modes** — `raw` (type width/height), `auto` (pick a ratio; edit one side, the other follows),
  `megapixel` (target megapixels + ratio; both computed).
- **Aspect ratios** — named presets from **1:1 (Square)** through **21:9 (Cinemascope)**. The list is
  square + landscape only; the **`⟷` flip button** transposes to portrait (16:9 → 9:16) and swaps
  width/height, so there's no duplicated 1:1.
- The readout shows the resulting **W × H**, megapixels, and the effective ratio + orientation. Wire
  `width`/`height` into a Prompt Builder; edits push into its canvas live and also apply on execution.
```

- [ ] **Step 2: Verify the section renders and links are intact**

Run: `python -m pytest -q` (sanity: docs change must not break the suite)
Expected: PASS — 55 passed, 1 skipped. Then eyeball the new section in `README.md`.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add Resolution Selector section to README"
```

---

## Self-Review

**Spec coverage:**
- Spec §1 (default profile + `snap_multiple`, warning gating, MP max 16) → Task 1 (`PROFILES`, `_rules`, `profile_clamps`) + Task 2 (`snap_multiple` input, `megapixels` max 16, tooltip). ✓
- Spec §2 (named half-list, single 1:1, label/value mapping, backward-compat remap) → Task 1 (`ASPECT_PRESETS`, `aspect_options`, `parse_ar`) + Task 2 (Combo options) + Task 3 (`remapAspectOnLoad`). ✓
- Spec §3 (orientation state, effective AR, flip button, orientation readout) → Task 1 (`effective_ar`) + Task 2 (`orientation` input) + Task 3 (`doFlip`, hidden orientation widget, readout suffix). ✓
- Spec §4 (JS/Python parity pipeline) → shared constants/math across Task 1 & Task 3. ✓
- Spec §5 (tests) → Task 1 Step 1 covers no-clamp, snap multiple, snap scope, transpose, Ideogram clamp, 21:9, backward compat. ✓
- README (noted as tracked separately in the spec) → Task 4. ✓

**Placeholder scan:** No TBD/TODO; every code step contains full code; every command has expected output. ✓

**Type consistency:** `resolve_dims(profile, mode, aspect, orientation, snap_multiple, mp, width, height)` — the signature and argument order are identical in Task 1 (definition), Task 1 tests, and Task 2 (`execute` call). Widget names `snap_multiple` / `orientation` match between Task 2 schema and Task 3 `findW` lookups. `effRules`/`_rules`, `profClamps`/`profile_clamps`, `parseAR`/`parse_ar`, `fitW`/`_fit_w` are the JS/Python mirror pairs. ✓
```
