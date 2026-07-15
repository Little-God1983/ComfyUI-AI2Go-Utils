# Resolution Selector — default profile, named ratios & orientation flip

**Date:** 2026-07-15
**Node:** `AI2GoResolutionSelector` (`nodes/resolution_selector.py`, `web/js/resolution_selector.js`)

## Problem

The Resolution Selector currently defaults to the **Ideogram 4** profile, which snaps to
multiples of 16 and clamps every side to 256–2048 px. Dropped into a *non*-Ideogram workflow,
that silently rewrites the user's resolution and shows an Ideogram-specific "clamped to keep
aspect" warning — confusing for anyone not targeting Ideogram.

Separately, the aspect-ratio dropdown is a flat list of 15 bare `W:H` strings mixing landscape
and portrait, with no human-readable names, and no ultra-wide (21:9) option.

## Goals

1. A **`default`** profile that does no model clamping and is the node's default selection.
2. Human-readable **names** on every aspect ratio.
3. Add **21:9 / 9:21** (and keep it general via the flip mechanism below).
4. Keep the "max … clamped to keep aspect" behaviour, but **only for profiles that clamp**
   (Ideogram 4) — never for `default`.
5. **Halve the dropdown**: show only square + landscape ratios; a **flip button** produces the
   portrait counterparts.

## Non-goals

- No changes to how width/height flow to a connected Prompt Builder (the push/apply mechanism
  stays as-is).
- No new README section in this change (tracked separately).
- No changes to `raw`-mode literal behaviour beyond the flip button also swapping W/H.

---

## 1. Profiles + configurable snap multiple

```python
PROFILES = {
    "default":    {"mult": None, "min": 1,   "max": 16384},  # mult comes from the snap_multiple widget
    "Ideogram 4": {"mult": 16,   "min": 256, "max": 2048},   # unchanged; model-locked
}
DEFAULT_PROFILE = "default"
```

- The `default` profile's effective multiple comes from a **new `snap_multiple` Int input**
  (default **8**, min **1**, max e.g. 1024, step 1). Its `mult` is `None` in the table as a
  sentinel meaning "read from the widget".
- Resolution of the effective multiple: `mult = profile["mult"] if profile["mult"] else snap_multiple`.
  So model profiles ignore the widget; `default` uses it.
- `snap_multiple` tooltip: *"Round each side to a multiple of this. Most diffusion models require
  multiples of 8, so keep it at 8 unless your model needs otherwise. Ignored by model profiles
  that define their own multiple (e.g. Ideogram 4 = 16)."*
- **Clamp warning gating:** a profile "clamps" when its `max < 16384` (i.e. a real model cap).
  The warning line is only computed/shown for clamping profiles. `default` (max 16384) never
  shows it.
- `megapixels` input max raised **4.2 → 16.0** so `default` isn't artificially capped. Ideogram 4
  still clamps to its 2048 cap and warns when a big MP target exceeds it.

### Widget visibility

`snap_multiple` is visible **only when the `default` profile is active** (hidden for Ideogram 4),
using the same `setWidgetVisible` show/hide trick already in the JS. Visibility is re-applied on
profile change and on `onConfigure` (workflow load).

## 2. Aspect ratios — half list with names

The dropdown lists only these base (square + landscape, `W ≥ H`) entries. Portrait versions are
produced by the flip button, never listed separately.

| Base ratio | Name | Portrait counterpart (name) |
|------------|------|------------------------------|
| 1:1  | Square        | — (flip is a no-op) |
| 5:4  | Large Format  | 4:5 Portrait Large Format |
| 4:3  | Standard      | 3:4 Portrait Standard |
| 3:2  | Photo         | 2:3 Portrait Photo |
| 16:10| Monitor       | 10:16 Portrait Monitor |
| 16:9 | Widescreen    | 9:16 Portrait Widescreen |
| 2:1  | Panorama      | 1:2 Portrait Panorama |
| 21:9 | Cinemascope   | 9:21 Portrait Cinemascope |
| 3:1  | Wide Panorama | 1:3 Portrait Wide Panorama |

- Combo **options are the label strings** (e.g. `"16:9 (Widescreen)"`); a parser extracts the
  leading `W:H` for the math. This keeps a single source of truth in the options list.
- Both Python and JS keep an identical ordered list `ASPECT_PRESETS` of `(ratio, name)` pairs.

## 3. Flip button + orientation state

**State:** a new **`orientation`** input — a `Combo` of `["landscape", "portrait"]`, default
`"landscape"`, **serialized** so saved workflows and headless/API runs match the UI.

**Effective aspect ratio** (used everywhere the math needs `ar`):

```
base = parse "W:H" from the selected preset label     # W >= H (landscape or square)
ar   = base            if orientation == landscape
     = 1 / base        if orientation == portrait      # transpose H:W
```

Python's `execute` applies this, so the INT outputs are correct headless. The JS mirrors it.

**Flip button:** a full-width native/DOM button whose label reflects state —
`⟷ Orientation: Landscape` / `⟷ Orientation: Portrait`. Pressing it:

1. Toggles `orientation`.
2. Swaps the current `width` / `height` widget values.
3. Recomputes + refreshes readout + pushes to connected targets.

Behaviour per mode:
- `auto` / `megapixel`: orientation changes the effective ratio (16:9 ⇄ 9:16); recompute follows.
- `raw`: orientation has no effect on the aspect (there is none), but the button still swaps W/H
  — a convenient "rotate my size". The button stays visible in all modes.
- Square (1:1): flip toggles orientation harmlessly; swapping equal-ish sides is a visual no-op.

**Readout** gains the effective ratio + orientation to remove ambiguity (the combo always shows a
landscape label even when portrait is active):

```
1080 × 1920    2.07 MP    ·    9:16 Portrait
```

For landscape the suffix reads e.g. `· 16:9 Landscape`; for 1:1, `· 1:1 Square`.

## 4. Data flow / parity

The JS and Python implement the same pipeline so UI readout == INT outputs:

```
profile + snap_multiple      -> effective mult, min, max (+ whether it clamps)
preset label + orientation   -> effective ar
mode (raw|auto|megapixel)    -> target width  (raw: literal; auto: driven side; mp: from MP+ar)
fitW / snap                  -> final (width, height), aspect preserved at a clamping cap
```

## 5. Testing

Comfy-free, run with `pytest` from repo root (torch/ComfyUI not required for the math):

- `default` profile: never clamps a large size (e.g. 5000×5000 stays 5000×5000 after /8 snap).
- `snap_multiple`: 1023 → 1024 at mult 8; 1000 → 1000; a different mult (e.g. 64) snaps to 64.
- `snap_multiple` scope: `default` *uses* it; Ideogram 4 *ignores* it and stays at mult 16 even
  when `snap_multiple` is set to something else.
- Orientation transpose: `16:9` + `portrait` → height-dominant dims (e.g. 1024-wide auto gives a
  taller-than-wide result); landscape gives wider-than-tall.
- Ideogram 4 still clamps + would-warn: a 4000-wide 16:9 request clamps to 2048×1152.
- New 21:9 / (flipped) 9:21 resolve to the correct ratios.

JS gets a syntax/ESM check only (per dev-env note); live browser checks deferred to the user.

## Files touched

- `nodes/resolution_selector.py`
- `web/js/resolution_selector.js`
- `tests/` (new/extended comfy-free test module)
