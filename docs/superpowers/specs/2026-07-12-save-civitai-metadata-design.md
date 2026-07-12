# Save Metadata (Civitai) — design

Two ComfyUI output nodes that save a PNG whose metadata **Civitai can read**, capturing the
*actual* prompt used on each run rather than the ComfyUI workflow. Part of ComfyUI-AI2Go-Utils
(GPL-3.0, like the rest of the pack).

## Motivation

ComfyUI's stock **Save Image** embeds two PNG text chunks — `prompt` (the API graph) and `workflow`
(the editor graph). Civitai can *sometimes* reconstruct generation parameters from those, but for a
**dynamic workflow the stored graph does not reflect the run**. Our own [AI2Go Prompt Batch]
(`nodes/prompt_batch.py`) is the worst case: the saved graph contains the whole `prompts_json` list
plus an `index`, so "the prompt for this image" is ambiguous just from the file — you cannot tell
which line produced it, and Civitai shows nothing useful.

Automatic1111 solves this by writing a flat, human-readable `parameters` text chunk (positive,
`Negative prompt:`, then a comma-separated settings line with `Steps`, `Sampler`, `CFG scale`, `Seed`,
`Size`, `Model`, `Model hash`, `Lora hashes`, …). **This `parameters` chunk is what Civitai parses**
to show the prompt and to auto-link the checkpoint and LoRAs (matched by hash). These nodes produce
that chunk from a ComfyUI graph.

Design priority, in order: **(1) the real positive/negative prompt actually used this run**, then
(2) the sampler settings, then (3) model + LoRA hashes so Civitai auto-links resources.

## The two nodes

Both are output nodes (`is_output_node=True`) built on the modern `comfy_api.latest.io` API. Both take
an `images` input, save PNG(s) to the output folder exactly like `SaveImage` (via
`folder_paths.get_save_image_path`, counter, `%date%`/token expansion, `%batch_num%`), return the
saved-image previews as `ui={"images": [...]}`, and pass `images` straight through as an output so the
node can sit inline. They differ only in **where the volatile per-run values come from**.

They share one engine: a **static graph tracer** + an **A1111 formatter** + a **file hasher**. The
Advanced node is the Basic node plus override sockets.

### Node A — Basic: "AI2Go Save Metadata (Civitai)"

- **node_id**: `AI2GoSaveCivitaiMetadata`, **category**: `AI2Go/image`.
- **Inputs**
  - `images` (IMAGE, required)
  - `filename_prefix` (STRING, default `"AI2Go"`)
  - `save_workflow` (BOOLEAN, default **False**) — see [File output](#file-output--save_workflow).
- **Everything else is auto-traced** from the graph (positive, negative, steps, cfg, seed, sampler,
  scheduler, denoise, model, LoRAs). See [The static tracer](#the-static-tracer).
- **Test button** (front-end) — previews exactly what the trace will write, before you queue a batch.
- **Outputs**: `images` (passthrough). **Hidden**: `prompt`, `extra_pnginfo`, `unique_id`.

### Node B — Advanced: "AI2Go Save Metadata (Civitai) Advanced"

Same as Basic, plus **optional override sockets** for the values that are volatile or hard to trace.
A wired socket wins; an unwired socket falls back to the auto-trace. Model + LoRAs are **always**
auto-traced (a variable-length LoRA list is awkward to socket, and the model chain is static graph
data anyway).

- **Extra optional inputs** (all `optional=True`, most `force_input=True` so they show as sockets):
  `positive` (STRING), `negative` (STRING), `steps` (INT), `cfg` (FLOAT), `seed` (INT),
  `sampler_name` (STRING), `scheduler` (STRING).
- Intended wiring: the Prompt Batch node's `positive`/`negative` outputs go straight into the
  matching sockets → the exact strings that ran are captured with zero tracing. This is the
  rock-solid path and the reason this node exists.
- Also has the **Test button** and the **`save_workflow`** toggle.

> Naming note: the request called these "Save Distinct Metadata" / "Distinct Metadata Advance". The
> display names above lead with "Civitai" because that states the purpose; node_ids are fixed
> regardless. Final display strings are the user's call at spec review — they touch only labels.

## Metadata format

One `tEXt` chunk named **`parameters`**, in A1111 order:

```
{positive}{ appended <lora:name:weight> tags }
Negative prompt: {negative}
Steps: {steps}, Sampler: {a1111_sampler}, CFG scale: {cfg}, Seed: {seed}, Size: {w}x{h}, Model hash: {model_hash}, Model: {model_name}, Lora hashes: "{name1}: {hash1}, {name2}: {hash2}", Version: ComfyUI
```

Rules:

- **Positive line** always present. Each traced LoRA is appended as ` <lora:{name}:{strength_model}>`
  (A1111 syntax, human-visible, and a second signal Civitai can parse). `name` is the LoRA filename
  without extension/subfolder.
- **Negative line** always emitted (empty allowed) — mirrors A1111.
- **Settings line** — comma-separated `Key: value`. Include a key only when known:
  - `Steps`, `Sampler` (mapped, see below), `CFG scale`, `Seed`, `Size` (from the saved image tensor
    `images[0].shape` → `WxH`), `Model` (checkpoint filename, no extension), `Model hash`.
  - `Denoising strength` — only when traced `denoise < 1.0` (hires/img2img).
  - `Clip skip` — only when a `CLIPSetLastLayer` is found in the CLIP chain (`abs(stop_at_clip_layer)`).
    Best-effort; omitted if absent.
  - `Lora hashes: "n1: h1, n2: h2"` — quoted, comma-separated. Omitted entirely when no LoRAs.
  - `Version: ComfyUI` — marks the origin.
- Unknown/unresolved fields are **omitted**, never guessed. The prompt fields, if unresolved, are
  written empty and the failure is surfaced (see [Failure handling](#failure-handling)).

### Hashing (AutoV2) & caching

Civitai matches a checkpoint/LoRA by a short hash it indexes for every file: **AutoV2 = first 10 hex
chars of the file's full SHA-256**. We compute that for the checkpoint and every traced LoRA.

- SHA-256 of a multi-GB checkpoint is slow (seconds→minutes), so results are **cached** in a JSON
  file in the pack directory (`.hash_cache.json`, git-ignored), keyed by `abs_path + size + mtime`.
  Cache hit → instant. First save of a new model pays the cost once, inside `execute` (blocking, but
  only once per file).
- Hash flavor (AutoV2 vs legacy AutoV1 "Model hash") **must be verified against a real Civitai
  upload** during implementation — see [Verification](#verification). The formatter takes the hashes
  as inputs, so switching flavor is a one-line change.

### Sampler / scheduler name mapping

ComfyUI names (`euler`, `euler_ancestral`, `dpmpp_2m` + scheduler `karras`) → A1111 names
(`Euler`, `Euler a`, `DPM++ 2M Karras`). A lookup table maps the common (sampler_name, scheduler)
pairs; unknown combinations fall back to a readable rendering of the raw ComfyUI name so nothing is
lost. Table lives in `sampler_names.py` and is unit-tested.

## The static tracer

Runs at save time (Python) and in the Test button (JS) — **mirrored logic, kept in sync** exactly as
`parsePrompts` mirrors `_parse_prompts` in the Prompt Batch node. Input: the **API prompt**
(`cls.hidden.prompt` in Python; `app.graphToPrompt()` / the live graph in JS) — a dict
`{node_id: {"class_type", "inputs"}}` where each input value is either a literal (widget) or
`[origin_id, output_slot]` (a link). The node finds *itself* via `cls.hidden.unique_id`.

Walk backward from **our own `images` input**:

1. **Find the sampler.** Follow image/latent links back to the nearest node whose `class_type` is a
   known sampler (`KSampler`, `KSamplerAdvanced`, and best-effort `SamplerCustom` /
   `SamplerCustomAdvanced`). If the image trace dead-ends, fall back to **the single sampler in the
   graph** (the documented "one KSampler" assumption). Read `steps`, `cfg`, `seed` (or `noise_seed`
   for the Advanced sampler), `sampler_name`, `scheduler`, `denoise`.
2. **Resolve prompts.** From `sampler.positive` / `sampler.negative` → the `CLIPTextEncode` node, then
   resolve its `text` input:
   - literal widget string → use it;
   - link → walk to the source node:
     - source is **`AI2GoPromptBatch`** → reuse its own `_parse_prompts` + `_select` on this run's
       `prompts_json` + `index` to reconstruct the exact line (**positive** = batch output slot 0,
       **negative** = slot 1). This is the whole point — the batch node stores `prompts_json`+`index`
       as widget values, so the API prompt for the run fully determines its output.
     - source is a plain primitive / string node → read its first non-empty string widget.
     - anything else → **unresolved**; leave blank and flag (use the Advanced node's socket).
   - If the conditioning passes through combiners (`ConditioningConcat`, ControlNet apply, etc.),
     walk back through the `conditioning` input to reach the underlying `CLIPTextEncode`. Best-effort;
     unresolved → flag.
3. **Model chain.** From `sampler.model`, walk `model` links backward, collecting each `LoraLoader` /
   `LoraLoaderModelOnly` (`lora_name`, `strength_model`) in order, until a `CheckpointLoaderSimple` /
   `CheckpointLoader` / `unCLIPCheckpointLoader` (`ckpt_name`). Multi-LoRA "stack" nodes (rgthree
   Power Lora Loader, `LoraLoaderStack`, …) have their own schema — best-effort support for the common
   ones, flag the rest.

The tracer returns a structured result: `{positive, negative, steps, cfg, seed, sampler_name,
scheduler, denoise, clip_skip, model_name, loras:[{name, strength}], unresolved:[field...]}`. The
Python side then hashes model+loras and hands everything to the formatter.

### JS ↔ Python mirroring contract

The Test button must show what save will write. Both sides implement the same walk; the JS side has
one extra power: it can resolve `AI2GoPromptBatch` from the **live** node (`_pbRows` + current `index`
widget) as well as from `prompts_json`, so the preview matches even mid-edit. Hashes are **not**
computed in JS (no file access) — the Test panel shows LoRA/model **names** and notes "hashes computed
on save". Any change to the trace rules updates both files; a comment in each points at the other
(same convention as prompt_batch).

## Test button

A front-end button (`🔎 Test detection`) on both nodes. On click it runs the JS trace against the live
graph and renders a compact read-only panel:

- detected **sampler** node (title/id) and its `steps / cfg / sampler / scheduler / seed / denoise`;
- **positive** and **negative** (resolved, including the batch node's current line);
- **model** name and **LoRAs** (name + strength), with "hashes computed on save";
- **Size**: shown as "from image at run" (the FE may not know it pre-run);
- any **unresolved** field highlighted (e.g. "negative ← `SomeCustomNode` — not resolvable, wire the
  Advanced node's `negative` socket").

This is the pre-flight check: catch an unresolvable prompt *before* queuing a 200-image batch.

## File output & `save_workflow`

Save path mirrors `SaveImage`: `folder_paths.get_save_image_path(filename_prefix, output_dir, w, h)`,
`{filename}_{counter:05}_.png`, `compress_level=4`, `%batch_num%` support, results returned as
`ui={"images": [UI.SavedResult(...)]}`.

- `save_workflow = False` (default) → write **only** the `parameters` chunk. No `prompt`/`workflow`
  chunks. A clean Civitai file; honors "do not save the workflow".
- `save_workflow = True` → **additionally** embed native `prompt` (`cls.hidden.prompt`) and `workflow`
  (from `cls.hidden.extra_pnginfo`) chunks, so the PNG is still drag-and-drop reproducible in ComfyUI.
  The `parameters` chunk is written **either way**.

Metadata is skipped entirely if ComfyUI is launched with `--disable-metadata` (respect `args`).

The toggle is on **both** nodes (proposed) — trivial and occasionally useful on Basic too. Easily
restricted to Advanced-only if preferred.

## Failure handling

- **Never lose the image.** If a field can't be resolved, the PNG is still saved with whatever *is*
  known; unresolved prompt fields are written empty and reported.
- **Reporting**: the Test button is the primary surface. At save time, unresolved fields are logged
  (`logging`) with the node id, and (nice-to-have) pushed to the node via
  `PromptServer.send_progress_text` so the canvas shows a short warning.
- **Multiple samplers / no sampler found**: image-trace first; else the single-sampler fallback; else
  flag "no sampler found — use the Advanced node and wire the values".
- Hash failures (missing file, read error) → omit that hash, keep the name, log; don't abort the save.

## File layout / modules

Small, focused units (the pack uses flat `nodes/*.py` + `web/js/*.js`):

- `nodes/civitai_metadata.py` — shared engine: the tracer, the A1111 formatter, the sampler map, and
  the hash+cache helper. Pure functions over the API-prompt dict → unit-testable without ComfyUI.
- `nodes/save_civitai_metadata.py` — the two thin `io.ComfyNode` classes (Basic + Advanced); both call
  the engine. Registered in `__init__.py` `NODE_CLASS_MAPPINGS` / `NODE_DISPLAY_NAME_MAPPINGS`.
- `web/js/save_civitai_metadata.js` — the Test button + the JS trace mirror. Uses `utility.js`
  `chainCallback`. Validate as an ES module (browser load), per repo memory.

(If `civitai_metadata.py` grows unwieldy, split tracer / formatter / hashing into a `nodes/metadata/`
package — decide during implementation.)

## Testing strategy

- **Python unit tests** (pytest, no ComfyUI needed — the engine is pure functions over dict fixtures):
  - tracer: static `CLIPTextEncode` text; prompt from `AI2GoPromptBatch` at index N (positive slot 0 /
    negative slot 1, with `delete_empty` behavior); LoraLoader chain (1 and N LoRAs) → checkpoint;
    multiple samplers resolved by image-trace; single-sampler fallback; unresolved source flagged;
    `KSamplerAdvanced` `noise_seed`.
  - formatter: exact `parameters` string for a known input (golden test); empty negative; no LoRAs
    (no `Lora hashes` key); `denoise < 1` adds `Denoising strength`; LoRA tags appended to positive.
  - sampler map: representative (sampler, scheduler) pairs; unknown pair falls back cleanly.
  - hash cache: hit/miss keyed by path+size+mtime (mock small temp files, not real checkpoints).
- **JS**: validate as ESM (`node --check` false-passes module syntax — load-test per repo memory).
- **Manual / integration** (ComfyUI running): save a PNG, inspect the `parameters` chunk (e.g. Pillow
  `img.text`), confirm it matches a static workflow *and* a Prompt Batch workflow at a chosen index;
  toggle `save_workflow` and confirm the `workflow` chunk appears/disappears.

### Verification

The one externally-dependent unknown is the **exact hash flavor Civitai matches on**. Before calling
this done, upload a generated PNG to Civitai (or check its metadata reader) and confirm the checkpoint
and LoRAs are auto-recognized. If not, adjust the hash (AutoV2 `sha256[:10]` vs legacy AutoV1) — a
localized change in the hashing helper, since the formatter just receives hash strings.

## Out of scope (v2 candidates)

- Tracing arbitrary third-party dynamic prompt nodes (LLM, wildcard, string-concat) — the Advanced
  node's sockets cover these deliberately.
- Full support for every LoRA-stack / custom-sampler node schema (start with the common ones).
- Non-PNG containers (JPEG/WebP EXIF/XMP), embedding preview grids, or ControlNet/hires-fix metadata
  beyond `Denoising strength`.

## Open decisions for spec review

1. **Display names** — "AI2Go Save Metadata (Civitai)" / "… Advanced" vs. your "Save Distinct
   Metadata" / "Distinct Metadata Advance".
2. **`save_workflow` on both nodes** vs. Advanced-only.
3. **`filename_prefix` default** — `"AI2Go"` proposed.
