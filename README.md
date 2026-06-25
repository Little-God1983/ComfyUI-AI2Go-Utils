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
- Copies carry a small `_ai2go` sidecar that preserves the full layout (groups + hierarchy) for a
  **lossless AI2Go → AI2Go** round-trip, while staying **two-way compatible with ComfyUI-KJNodes**:
  KJNodes ignores the extra data and loads the flat scene, and KJNodes captions load here flat too.
  The sidecar never reaches the model prompt.

## Credits & License

Licensed under **GPL-3.0** — see [LICENSE](LICENSE).

This pack is built on the **Ideogram 4 Prompt Builder** node and editor from
[**ComfyUI-KJNodes**](https://github.com/kijai/ComfyUI-KJNodes) by **Kijai**, which is licensed under
GPL-3.0. Huge thanks to Kijai for the original work — the derived files retain their attribution, and
per GPL-3.0 this pack is released under the same license.
