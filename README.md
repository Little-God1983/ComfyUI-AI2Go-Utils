![ComfyUI-AI2Go-Utils](assets/AI2Go-Banner.jpg)

# ComfyUI-AI2Go-Utils

ComfyUI nodepack by AIKnowledge2Go

> ℹ️ **Published for reference.** Issues are disabled and pull requests are closed automatically —
> this repo doesn't accept contributions, and no support is provided. You're welcome to fork and
> adapt it under the GPL-3.0 license.

## Contact

- **YouTube:** [@AIKnowledge2Go](https://www.youtube.com/@AIKnowledge2Go)
- **Patreon:** [AIKnowledgeCentral](https://patreon.com/AIKnowledgeCentral)
- **Book an appointment:** [1hr 1-on-1 Stable Diffusion](https://koalendar.com/e/1hr-1-on-1-stable-diffusion)
- **Email:** BeyondMatrixDevelopments@gmail.com
- **Civitai:** [AIknowlege2go](https://civitai.com/user/AIknowlege2go)

## Installation

Clone into your ComfyUI `custom_nodes` directory and restart ComfyUI:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Little-God1983/ComfyUI-AI2Go-Utils
```

No extra dependencies (it uses Pillow, already shipped with ComfyUI). It can coexist with
ComfyUI-KJNodes — both Ideogram 4 nodes run side by side without conflict.

## Nodes

### AI2Go Ideogram 4 Prompt Builder

A visual prompt builder for **Ideogram 4's structured JSON caption** format. Draw bounding-box
**regions** on a canvas, describe each one, and the node assembles the caption — with a full
scene-graph **Overview**, region **parenting**, and named **groups** layered on top.

**Outputs:** `prompt` (the caption JSON), `preview` (a rendered overlay image), `bboxes`
(pixel-space boxes for SAM3 / crop nodes), `width`, `height`.

![How it works](assets/How-It-Works.jpg)

#### Region editor (canvas)

- **Draw** by dragging; move and resize with handles; **Ctrl-drag** to force-draw over an existing box.
- Per-region **type** (object / text), description, verbatim text, and a **color palette**; editable
  bbox fields (pixels + the 0–1000 grid).
- **Multi-select** — shift-drag marquee, shift-click toggle; **Alt-click** cycles overlapping boxes;
  **Del** / **Ctrl+C·V·D** to remove / copy / paste / duplicate.
- **Lock** regions, composition **guides** (thirds / grid / golden ratio / spiral), **snap-to-grid**,
  and adjustable label & box styling.
- **Background**: a connected reference image, the **last generated image** ("Grab BG"), or the
  **live sampling preview** — with a brightness control.
- Dockable / pinnable / fullscreen panel, a live **token estimate**, and output settings
  (compact/pretty JSON, normalized/absolute coords, `yx`/`xy` bbox order).

#### Overview (scene tree)

- A persistent, collapsible panel listing **every region** — click a row to select it (synced both
  ways with the canvas), so you can pick and edit a region without nudging it.
- **Ctrl/Cmd-click** to multi-select, **Shift-click** for a range.
- Lock, duplicate, and delete from the list; **drag a row — or a whole multi-selection — onto another
  to nest it**; drop on the header to send back to root.

#### Parenting & groups

- **Parent** any region under another: move a parent on the canvas and its children follow. Deleting a
  parent promotes its children to the grandparent (no surprise subtree wipe).
- **Groups** — right-click the Overview → *Create group from selection* to wrap regions in a **named**
  container:
  - Move the group → everything moves; **resize the group → its members scale**.
  - **Duplicate** the whole group, or **mirror** its members **horizontally / vertically**.
  - Deleting a group keeps its children.
  - Groups are editor-only organizers — **never part of the exported prompt**. Toggle their frames on
    the canvas with **👁️** (hidden by default; always listed in the Overview).

#### Copy / paste & interop

- **Copy** / **Paste** the caption JSON, and save/load named **Templates** (stored server-side).
  Each template can carry an optional **preview image** — click 📷 in the Templates menu to pick one
  (it's center-cropped to a 200×200 webp), or just drop a matching `<template-name>.{webp,png,jpg,jpeg}`
  next to the template file and it's picked up automatically.
- Copies carry a small `_ai2go` sidecar that preserves the full layout (groups + hierarchy) for a
  **lossless AI2Go → AI2Go** round-trip, while staying **two-way compatible with ComfyUI-KJNodes**:
  KJNodes ignores the extra data and loads the flat scene, and KJNodes captions load here flat too.
  The sidecar never reaches the model prompt.

### AI2Go Ideogram 4 Style Wizard

A "click-together" helper for the **style fields** of an Ideogram 4 caption — so you don't have to type
`aesthetics` / `lighting` / `medium` / `photo` / `art_style` by hand.

- Wire the wizard's **`style`** output into a **Prompt Builder's `import_json`** input (the link just
  tells the wizard which builder to fill).
- Click **🪄 Open Style Wizard** to open a two-tab modal. On the **Pick styles** tab, toggle one or many
  chips per category (they're comma-joined) or type your own; a **search box** filters chips, a **live
  JSON preview** shows the assembled `style_description`, and a **status line** names the builder you're
  writing to (or warns if nothing's connected).
- **Photo vs. art_style** are both selectable; if you set both, a warning notes that only `photo` is
  applied (Ideogram allows only one).
- **Apply** pushes the picks to the connected builder without closing (handy for tweaking); **Apply &
  close** (and Esc / clicking the backdrop) does the same and closes. Either way the picks are
  **written straight into the builder's** style widgets — your bounding boxes, color palette, and
  `high_level_description` are left untouched, and the node emits an empty string at run time so the
  `import_json` wire never overwrites the builder's regions.

**Editable chip presets.** The chip lists live in
`ComfyUI/user/default/ai2go/ideogram4/WizardStylesDefault.json`. Edit them right in the wizard on the
**Edit presets** tab — add, rename, or delete chips per category, then **Save to file** (or **Discard** /
**Restore defaults**). You can also hand-edit the JSON (each entry's `key` must be one of `aesthetics`,
`lighting`, `medium`, `photo`, `art_style`). If the file is **missing or malformed**, the wizard falls
back to the built-in defaults and shows a warning (with the exact parse error) plus a **Restore
defaults** button that (re)creates the file.

### AI2Go Prompt Batch

Run a **list of prompts one at a time** across a queued batch — the text analog of the classic
"Load Image Batch + increment index" trick. ComfyUI has no real for-loop, so you queue N runs by hand
and this node walks the list, emitting one prompt per run.

**Outputs:** `positive`, `negative`, `index` (the 0-based index used this run — wire it into a
SaveImage filename so each file records *which prompt* made it).

![AI2Go Prompt Batch](assets/Batch.png)

#### Editing prompts

- A dynamic **row editor** (in the spirit of rgthree's Power Lora Loader): each row is a **positive**
  and **negative** text box side by side. **➕ Add Prompt** appends a row, **🗑** removes one, and the
  **⠿** handle drag-reorders. The node **auto-grows and auto-shrinks** to fit; stretch it wider for
  roomier boxes.
- **📥 Read from JSON** — wire a text/primitive node holding a JSON prompt list into the optional
  `json_in` socket, then click to **append** it to the rows.
- **🗑 Clear All** wipes the list.
- The rows are the source of truth; internally they serialize to the JSON array
  `[{"positive": "...", "negative": "..."}, ...]` (a bare string is treated as positive-only), stored
  in a hidden field that both saves with the workflow and drives execution.

#### Running a batch

1. Build the list, then click **🔍 Check for prompts** — it validates, counts N, resets the index to 0,
   and tells you how many runs to queue.
2. Set ComfyUI's **queue/run count to N** and run. The node advances `index` by 1 after each run
   (immune to the "Widget Value Control Mode" setting), walking 0, 1, 2… across the batch.

**Toggles.**

- **Reset index at batch start** (default on) — zero the index when a new batch is queued, so every
  batch starts from the first prompt.
- **Delete empty prompts** (default on) — drop rows with an empty positive on **Check** and just before
  a batch is queued, so blank rows never break a run or skew the count.

If the index ever overshoots the list (more runs than prompts), it clamps to the last prompt instead of
erroring.

## Credits & License

Licensed under **GPL-3.0** — see [LICENSE](LICENSE).

This pack is built on the **Ideogram 4 Prompt Builder** node and editor from
[**ComfyUI-KJNodes**](https://github.com/kijai/ComfyUI-KJNodes) by **Kijai**, which is licensed under
GPL-3.0. Huge thanks to Kijai for the original work — the derived files retain their attribution, and
per GPL-3.0 this pack is released under the same license.
