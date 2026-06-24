# ComfyUI-AI2Go-Utils

ComfyUI nodepack by AIKnowledge2Go

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

## Nodes

### AI2Go Ideogram 4 Prompt Builder

A visual prompt builder for Ideogram 4's structured JSON caption format. Draw bounding-box
regions on a canvas, set each region's type / description / text / colors, and the node assembles
the caption JSON.

Includes an **Object Explorer** — a docked, collapsible list of every region. Click a row to
select it (two-way with the canvas), so you can pick and edit regions without accidentally
nudging them on the canvas. Reorder, lock, duplicate, and delete from the list. (Region
parenting / hierarchy is planned.)

## License & Credits

Licensed under **GPL-3.0** (see [LICENSE](LICENSE)).

This pack builds on the **Ideogram 4 Prompt Builder** node and editor from
[ComfyUI-KJNodes](https://github.com/kijai/ComfyUI-KJNodes) by **Kijai**, which is
licensed under GPL-3.0. Derived files retain their original attribution.
