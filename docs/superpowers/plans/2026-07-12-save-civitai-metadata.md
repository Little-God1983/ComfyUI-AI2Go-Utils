# Save Metadata (Civitai) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two ComfyUI output nodes that save a PNG with an A1111-format `parameters` text chunk Civitai can read, capturing the *real* prompt used each run (including the Prompt Batch line at its run index) plus model/LoRA AutoV2 hashes.

**Architecture:** A pure, comfy-free engine (graph tracer + A1111 formatter + file hasher + PNG-metadata builder) under `nodes/civitai_metadata/`, unit-tested with plain dicts. Two thin `io.ComfyNode` classes in `nodes/save_civitai_metadata.py` call the engine, resolve file hashes via `folder_paths`, and save PNGs like `SaveImage`. A JS front-end mirrors the tracer for a Test-detection preview button.

**Tech Stack:** Python 3, `comfy_api.latest.io` node API, Pillow (PngInfo), pytest (dev), ComfyUI front-end JS (ES modules).

## Global Constraints

- **License header:** every new `.py`/`.js` starts with a short comment noting it is part of ComfyUI-AI2Go-Utils, GPL-3.0 (match `nodes/prompt_batch.py`).
- **Engine is comfy-free:** modules under `nodes/civitai_metadata/` MUST NOT import `comfy_api`, `folder_paths`, `torch`, or `server`. They operate on plain dicts / paths so pytest runs without ComfyUI. Only `nodes/save_civitai_metadata.py` imports ComfyUI.
- **Node API:** use `from comfy_api.latest import io` (lowercase, as the existing pack nodes do) and `from comfy_api.latest import ui`.
- **Fixed node_ids:** `AI2GoSaveCivitaiMetadata` (Basic), `AI2GoSaveCivitaiMetadataAdvanced` (Advanced). Keys in `NODE_CLASS_MAPPINGS` MUST match these.
- **Display names:** `AI2Go Save Metadata (Civitai)` and `AI2Go Save Metadata (Civitai) Advanced`. **Category:** `AI2Go/image`.
- **Defaults:** `filename_prefix` = `"AI2Go"`; `save_workflow` = `False`; both toggles present on **both** nodes.
- **Hash:** AutoV2 = first 10 hex chars of the file's full SHA-256.
- **Mirror contract:** the JS tracer in `web/js/save_civitai_metadata.js` and the Python tracer in `nodes/civitai_metadata/tracer.py` implement the same walk; each file's header comment points at the other (same convention as `parsePrompts` ↔ `_parse_prompts`).
- **JS is ESM:** validate by browser load, not `node --check` (per repo memory `validate-web-js-as-esm`).
- **Reload:** Python changes need a full ComfyUI server restart; JS needs a hard browser refresh (per repo memory `comfyui-reload-loop`).

---

### Task 0: Test infrastructure

**Files:**
- Create: `conftest.py`
- Modify: `requirements.txt` (add a dev note), `.gitignore`
- Create: `tests/` (via the first test file in Task 1)

**Interfaces:**
- Produces: repo root on `sys.path` so tests can `import nodes.civitai_metadata.*` and `import nodes.prompt_batch_core`.

- [ ] **Step 1: Create `conftest.py` at repo root**

```python
# Pytest bootstrap for ComfyUI-AI2Go-Utils. Puts the repo root on sys.path so tests can
# import the comfy-free engine modules (`nodes.civitai_metadata.*`, `nodes.prompt_batch_core`)
# without a ComfyUI install. GPL-3.0, like the rest of the pack.
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
```

- [ ] **Step 2: Ignore the hash cache**

Add to `.gitignore` (under the `# Logs` block or a new `# AI2Go` block):

```
# AI2Go generated
.hash_cache.json
```

- [ ] **Step 3: Note pytest as a dev dependency**

Append to `requirements.txt`:

```
# dev/test only (not needed at runtime):
# pytest>=8.0
```

Then install locally: `python -m pip install pytest`

- [ ] **Step 4: Commit**

```bash
git add conftest.py .gitignore requirements.txt
git commit -m "test: add pytest bootstrap and ignore hash cache"
```

---

### Task 1: Extract Prompt Batch parsing into a comfy-free core

The tracer must reproduce exactly what `AI2GoPromptBatch` emits for a run (positive/negative at an index). `nodes/prompt_batch.py` imports `comfy_api`, so its `_parse_prompts`/`_select` can't be imported in tests. Move them to a pure module and have `prompt_batch.py` re-import them (behavior unchanged).

**Files:**
- Create: `nodes/prompt_batch_core.py`
- Modify: `nodes/prompt_batch.py` (top of file: replace the inline defs with an import)
- Test: `tests/test_prompt_batch_core.py`

**Interfaces:**
- Produces:
  - `DEFAULT_PROMPTS_JSON: str`
  - `parse_prompts(raw: str) -> list[tuple[str, str]]` — raises `ValueError` on malformed input.
  - `select_prompt(prompts: list[tuple[str, str]], index) -> tuple[str, str, int]` — clamps index, never raises.

- [ ] **Step 1: Write the failing test**

Create `tests/test_prompt_batch_core.py`:

```python
import json
import pytest
from nodes.prompt_batch_core import parse_prompts, select_prompt, DEFAULT_PROMPTS_JSON


def test_parse_object_list():
    raw = json.dumps([{"positive": "fox", "negative": "blur"}, {"positive": "city"}])
    assert parse_prompts(raw) == [("fox", "blur"), ("city", "")]


def test_parse_string_shorthand_and_wrapper():
    assert parse_prompts(json.dumps(["lonely fox"])) == [("lonely fox", "")]
    assert parse_prompts(json.dumps({"prompts": [{"positive": "x"}]})) == [("x", "")]


def test_parse_errors():
    with pytest.raises(ValueError):
        parse_prompts("")
    with pytest.raises(ValueError):
        parse_prompts("{not json")
    with pytest.raises(ValueError):
        parse_prompts(json.dumps([{"positive": "  "}]))  # empty positive


def test_select_clamps():
    prompts = [("a", ""), ("b", "n")]
    assert select_prompt(prompts, 1) == ("b", "n", 1)
    assert select_prompt(prompts, 9) == ("b", "n", 1)   # overshoot clamps to last
    assert select_prompt(prompts, -3) == ("a", "", 0)   # negative clamps to 0
    assert select_prompt(prompts, None) == ("a", "", 0)  # non-int tolerated


def test_default_json_is_valid():
    assert len(parse_prompts(DEFAULT_PROMPTS_JSON)) >= 1
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_prompt_batch_core.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'nodes.prompt_batch_core'`

- [ ] **Step 3: Create `nodes/prompt_batch_core.py`**

Move the logic verbatim from `nodes/prompt_batch.py` (public names). This is the single source of truth mirrored by `web/js/prompt_batch.js`.

```python
# Prompt Batch parsing core — part of ComfyUI-AI2Go-Utils. GPL-3.0, like the rest of the pack.
#
# Pure (comfy-free) parse/select logic shared by the Prompt Batch node (nodes/prompt_batch.py) and
# the Civitai metadata tracer (nodes/civitai_metadata/tracer.py). Mirrored in web/js/prompt_batch.js
# — keep the three in sync.
import json
import logging

logger = logging.getLogger(__name__)

DEFAULT_PROMPTS_JSON = json.dumps(
    [
        {"positive": "a red fox in the snow, highly detailed, 8k", "negative": "blurry, watermark"},
        {"positive": "a neon-lit city street at night, cinematic", "negative": ""},
    ],
    indent=2,
)


def parse_prompts(raw):
    """Parse the prompts JSON into a list of ``(positive, negative)`` string pairs.

    Accepts a JSON array of objects (canonical), a bare string entry (positive-only shorthand), or a
    ``{"prompts": [...]}`` wrapper. Raises ``ValueError`` with a human-readable message on anything
    malformed.
    """
    text = (raw or "").strip()
    if not text:
        raise ValueError("Prompt JSON is empty — paste a JSON array of prompts.")
    try:
        data = json.loads(text)
    except json.JSONDecodeError as e:
        raise ValueError(f"Malformed JSON: {e.msg} (line {e.lineno}, column {e.colno}).") from e

    if isinstance(data, dict) and isinstance(data.get("prompts"), list):
        data = data["prompts"]
    if not isinstance(data, list):
        raise ValueError('Expected a JSON array of prompts, e.g. [{"positive": "..."}, ...].')
    if not data:
        raise ValueError("Prompt list is empty — it needs at least one prompt.")

    prompts = []
    for i, entry in enumerate(data):
        where = f"Prompt #{i + 1}"
        if isinstance(entry, str):
            positive, negative = entry, ""
        elif isinstance(entry, dict):
            positive = entry.get("positive", entry.get("prompt", ""))
            negative = entry.get("negative", "")
            if negative is None:
                negative = ""
            if not isinstance(positive, str):
                raise ValueError(f"{where}: 'positive' must be a string.")
            if not isinstance(negative, str):
                raise ValueError(f"{where}: 'negative' must be a string.")
        else:
            raise ValueError(f"{where}: each entry must be an object with a 'positive' field (or a plain string).")
        if not positive.strip():
            raise ValueError(f"{where}: 'positive' is empty.")
        prompts.append((positive, negative))
    return prompts


def select_prompt(prompts, index):
    """Pick the prompt at ``index``, clamping into range (never raises).

    Returns ``(positive, negative, used_index)``.
    """
    count = len(prompts)
    try:
        idx = int(index)
    except (TypeError, ValueError):
        logger.warning("AI2Go Prompt Batch: index %r is not an int, using 0.", index)
        idx = 0
    if idx < 0:
        idx = 0
    elif idx >= count:
        idx = count - 1
    positive, negative = prompts[idx]
    return positive, negative, idx
```

- [ ] **Step 4: Rewire `nodes/prompt_batch.py` to use the core**

In `nodes/prompt_batch.py`, delete the inline `DEFAULT_PROMPTS_JSON`, `_parse_prompts`, and `_select` definitions (lines defining them, currently ~37–114) and add this import near the top (after `import logging`):

```python
from .prompt_batch_core import DEFAULT_PROMPTS_JSON, parse_prompts as _parse_prompts, select_prompt as _select
```

Leave every other reference to `_parse_prompts`, `_select`, and `DEFAULT_PROMPTS_JSON` untouched — they now resolve to the imported names.

- [ ] **Step 5: Run tests to verify they pass**

Run: `python -m pytest tests/test_prompt_batch_core.py -v`
Expected: PASS (5 tests)

- [ ] **Step 6: Commit**

```bash
git add nodes/prompt_batch_core.py nodes/prompt_batch.py tests/test_prompt_batch_core.py
git commit -m "refactor: extract prompt batch parse/select into comfy-free core"
```

---

### Task 2: Sampler-name mapping

**Files:**
- Create: `nodes/civitai_metadata/__init__.py` (empty package marker)
- Create: `nodes/civitai_metadata/sampler_names.py`
- Test: `tests/test_sampler_names.py`

**Interfaces:**
- Produces: `to_a1111_sampler(sampler_name: str, scheduler: str) -> str`

- [ ] **Step 1: Write the failing test**

Create `tests/test_sampler_names.py`:

```python
from nodes.civitai_metadata.sampler_names import to_a1111_sampler


def test_known_pairs():
    assert to_a1111_sampler("euler", "normal") == "Euler"
    assert to_a1111_sampler("euler_ancestral", "normal") == "Euler a"
    assert to_a1111_sampler("dpmpp_2m", "karras") == "DPM++ 2M Karras"
    assert to_a1111_sampler("dpmpp_2m", "exponential") == "DPM++ 2M Exponential"


def test_unknown_sampler_falls_back_readably():
    assert to_a1111_sampler("brand_new_sampler", "normal") == "Brand New Sampler"


def test_unknown_scheduler_appended():
    assert to_a1111_sampler("euler", "weird_sched") == "Euler weird_sched"


def test_empty_inputs():
    assert to_a1111_sampler("", "") == "Unknown"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_sampler_names.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Create the package marker and module**

Create empty `nodes/civitai_metadata/__init__.py`:

```python
# Civitai metadata engine (comfy-free) — part of ComfyUI-AI2Go-Utils. GPL-3.0.
```

Create `nodes/civitai_metadata/sampler_names.py`:

```python
# ComfyUI -> A1111 sampler-label mapping — part of ComfyUI-AI2Go-Utils. GPL-3.0.
#
# Civitai/A1111 read a sampler *label* (e.g. "DPM++ 2M Karras"). ComfyUI stores a (sampler_name,
# scheduler) pair. Map the common pairs; fall back to a readable rendering so nothing is lost.

_SAMPLER_LABELS = {
    "euler": "Euler",
    "euler_cfg_pp": "Euler",
    "euler_ancestral": "Euler a",
    "euler_ancestral_cfg_pp": "Euler a",
    "heun": "Heun",
    "heunpp2": "Heun",
    "dpm_2": "DPM2",
    "dpm_2_ancestral": "DPM2 a",
    "lms": "LMS",
    "dpm_fast": "DPM fast",
    "dpm_adaptive": "DPM adaptive",
    "dpmpp_2s_ancestral": "DPM++ 2S a",
    "dpmpp_sde": "DPM++ SDE",
    "dpmpp_sde_gpu": "DPM++ SDE",
    "dpmpp_2m": "DPM++ 2M",
    "dpmpp_2m_sde": "DPM++ 2M SDE",
    "dpmpp_2m_sde_gpu": "DPM++ 2M SDE",
    "dpmpp_3m_sde": "DPM++ 3M SDE",
    "dpmpp_3m_sde_gpu": "DPM++ 3M SDE",
    "ddim": "DDIM",
    "uni_pc": "UniPC",
    "uni_pc_bh2": "UniPC",
    "lcm": "LCM",
}

# Schedulers A1111 treats as the plain sampler (no suffix).
_PLAIN_SCHEDULERS = {"normal", "simple", "sgm_uniform", "ddim_uniform", "beta", "", None}


def to_a1111_sampler(sampler_name, scheduler):
    base = _SAMPLER_LABELS.get(sampler_name)
    if base is None:
        base = sampler_name.replace("_", " ").title() if sampler_name else "Unknown"
    if scheduler == "karras":
        return f"{base} Karras"
    if scheduler == "exponential":
        return f"{base} Exponential"
    if scheduler in _PLAIN_SCHEDULERS:
        return base
    return f"{base} {scheduler}"  # unknown scheduler: append raw, lose nothing
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_sampler_names.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add nodes/civitai_metadata/__init__.py nodes/civitai_metadata/sampler_names.py tests/test_sampler_names.py
git commit -m "feat: ComfyUI->A1111 sampler-name mapping"
```

---

### Task 3: A1111 `parameters` formatter

**Files:**
- Create: `nodes/civitai_metadata/a1111.py`
- Test: `tests/test_a1111.py`

**Interfaces:**
- Produces: `format_parameters(*, positive, negative, steps, cfg, seed, sampler, width, height, model_name=None, model_hash=None, loras=None, denoise=None, clip_skip=None, version="ComfyUI") -> str`
  - `loras`: `list[dict]` with keys `name` (str), `strength` (number|None), `hash` (str|None).

- [ ] **Step 1: Write the failing test**

Create `tests/test_a1111.py`:

```python
from nodes.civitai_metadata.a1111 import format_parameters


def test_full_golden_string():
    out = format_parameters(
        positive="a red fox, 8k", negative="blurry",
        steps=30, cfg=6.5, seed=12345, sampler="DPM++ 2M Karras",
        width=1024, height=1024,
        model_name="myCkpt", model_hash="a1b2c3d4e5",
        loras=[{"name": "styleLora", "strength": 0.8, "hash": "1122aabbcc"}],
        denoise=1.0, clip_skip=None,
    )
    assert out == (
        "a red fox, 8k <lora:styleLora:0.8>\n"
        "Negative prompt: blurry\n"
        "Steps: 30, Sampler: DPM++ 2M Karras, CFG scale: 6.5, Seed: 12345, "
        "Size: 1024x1024, Model hash: a1b2c3d4e5, Model: myCkpt, "
        'Lora hashes: "styleLora: 1122aabbcc", Version: ComfyUI'
    )


def test_integral_floats_trimmed_and_empty_negative():
    out = format_parameters(
        positive="cat", negative="", steps=20, cfg=7.0, seed=1, sampler="Euler",
        width=512, height=768,
    )
    lines = out.split("\n")
    assert lines[0] == "cat"
    assert lines[1] == "Negative prompt: "
    assert "CFG scale: 7," in lines[2]          # 7.0 -> 7
    assert "Size: 512x768" in lines[2]
    assert "Lora hashes" not in out             # no loras -> no key
    assert "Model" not in out                   # no model -> no key


def test_denoise_and_clip_skip_conditional():
    out = format_parameters(
        positive="x", negative="", steps=20, cfg=7, seed=1, sampler="Euler",
        width=64, height=64, denoise=0.55, clip_skip=2,
    )
    assert "Denoising strength: 0.55" in out
    assert "Clip skip: 2" in out


def test_lora_tag_without_hash_still_appended():
    out = format_parameters(
        positive="x", negative="", steps=20, cfg=7, seed=1, sampler="Euler",
        width=64, height=64, loras=[{"name": "noHashLora", "strength": 1.0}],
    )
    assert "<lora:noHashLora:1>" in out.split("\n")[0]
    assert "Lora hashes" not in out             # no hash -> not in settings line
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_a1111.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Create `nodes/civitai_metadata/a1111.py`**

```python
# A1111 `parameters` chunk formatter — part of ComfyUI-AI2Go-Utils. GPL-3.0.
#
# Produces the flat text Civitai parses: positive (+ appended <lora:...> tags), a "Negative prompt:"
# line, then a comma-separated settings line. Unknown/None fields are omitted, never guessed.


def _num(x):
    """Render a number A1111-style: ints stay ints, integral floats drop the .0 (7.0 -> 7)."""
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return str(x)


def format_parameters(*, positive, negative, steps, cfg, seed, sampler, width, height,
                      model_name=None, model_hash=None, loras=None, denoise=None,
                      clip_skip=None, version="ComfyUI"):
    loras = loras or []
    tags = " ".join(
        f"<lora:{lo['name']}:{_num(lo['strength'])}>"
        for lo in loras if lo.get("strength") is not None
    )
    pos = (positive or "").strip()
    pos_line = (pos + " " + tags).strip() if tags else pos
    lines = [pos_line, f"Negative prompt: {negative or ''}"]

    parts = []

    def add(key, val):
        if val is not None and val != "":
            parts.append(f"{key}: {val}")

    add("Steps", _num(steps) if steps is not None else None)
    add("Sampler", sampler or None)
    add("CFG scale", _num(cfg) if cfg is not None else None)
    add("Seed", _num(seed) if seed is not None else None)
    add("Size", f"{width}x{height}")
    add("Model hash", model_hash)
    add("Model", model_name)
    if denoise is not None and float(denoise) < 1.0:
        add("Denoising strength", _num(denoise))
    if clip_skip is not None:
        add("Clip skip", _num(clip_skip))
    hashed = [lo for lo in loras if lo.get("hash")]
    if hashed:
        inner = ", ".join(f"{lo['name']}: {lo['hash']}" for lo in hashed)
        add("Lora hashes", f'"{inner}"')
    add("Version", version)

    lines.append(", ".join(parts))
    return "\n".join(lines)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_a1111.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add nodes/civitai_metadata/a1111.py tests/test_a1111.py
git commit -m "feat: A1111 parameters formatter"
```

---

### Task 4: File hashing with a persistent cache

**Files:**
- Create: `nodes/civitai_metadata/hashing.py`
- Test: `tests/test_hashing.py`

**Interfaces:**
- Produces:
  - `sha256_autov2(path: str) -> str` — first 10 hex of full SHA-256.
  - `class HashCache(cache_path: str)` with `get(path: str) -> str | None` (computes+persists on miss, keyed by abspath+size+mtime; `None` if file missing/unreadable).

- [ ] **Step 1: Write the failing test**

Create `tests/test_hashing.py`:

```python
import hashlib
import nodes.civitai_metadata.hashing as hashing
from nodes.civitai_metadata.hashing import sha256_autov2, HashCache


def test_autov2_matches_sha256_prefix(tmp_path):
    f = tmp_path / "model.bin"
    f.write_bytes(b"hello")
    expected = hashlib.sha256(b"hello").hexdigest()[:10]
    assert sha256_autov2(str(f)) == expected
    assert expected == "2cf24dba5f"


def test_missing_file_returns_none(tmp_path):
    cache = HashCache(str(tmp_path / "cache.json"))
    assert cache.get(str(tmp_path / "nope.bin")) is None


def test_cache_hit_does_not_recompute(tmp_path, monkeypatch):
    f = tmp_path / "model.bin"
    f.write_bytes(b"hello")
    cache = HashCache(str(tmp_path / "cache.json"))
    assert cache.get(str(f)) == "2cf24dba5f"

    # Second call must hit the cache: make recompute explode if it is called.
    def boom(_):
        raise AssertionError("recomputed despite cache hit")
    monkeypatch.setattr(hashing, "sha256_autov2", boom)
    cache2 = HashCache(str(tmp_path / "cache.json"))  # reloads persisted cache
    assert cache2.get(str(f)) == "2cf24dba5f"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_hashing.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Create `nodes/civitai_metadata/hashing.py`**

```python
# AutoV2 file hashing + cache — part of ComfyUI-AI2Go-Utils. GPL-3.0.
#
# Civitai matches a checkpoint/LoRA by AutoV2 = first 10 hex of the file's full SHA-256. Hashing a
# multi-GB checkpoint is slow, so results are cached to JSON keyed by abspath+size+mtime.
import hashlib
import json
import os


def sha256_autov2(path):
    """First 10 hex chars of the file's full SHA-256 (the value Civitai indexes)."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()[:10]


class HashCache:
    def __init__(self, cache_path):
        self.cache_path = cache_path
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                self._data = json.load(f)
        except (OSError, ValueError):
            self._data = {}

    def get(self, path):
        """AutoV2 hash for ``path``; compute+persist on miss. None if missing/unreadable."""
        if not path:
            return None
        try:
            st = os.stat(path)
        except OSError:
            return None
        key = os.path.abspath(path)
        entry = self._data.get(key)
        if entry and entry.get("size") == st.st_size and entry.get("mtime") == st.st_mtime:
            return entry.get("hash")
        try:
            # Module-qualified so tests can monkeypatch sha256_autov2 to assert cache hits.
            digest = sha256_autov2(path)
        except OSError:
            return None
        self._data[key] = {"size": st.st_size, "mtime": st.st_mtime, "hash": digest}
        self._save()
        return digest

    def _save(self):
        try:
            with open(self.cache_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f)
        except OSError:
            pass
```

Note: `get` calls the module-level `sha256_autov2` name (not a local alias) so `monkeypatch.setattr(hashing, "sha256_autov2", ...)` in the test takes effect.

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_hashing.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add nodes/civitai_metadata/hashing.py tests/test_hashing.py
git commit -m "feat: AutoV2 file hashing with persistent cache"
```

---

### Task 5: PNG metadata builder

**Files:**
- Create: `nodes/civitai_metadata/png_info.py`
- Test: `tests/test_png_info.py`

**Interfaces:**
- Produces: `build_pnginfo(parameters: str, *, extra_pnginfo: dict | None = None, prompt: dict | None = None) -> PngInfo`
  - Always writes the `parameters` chunk. When `prompt` given, adds a `prompt` chunk. When `extra_pnginfo` given, adds one chunk per key (e.g. `workflow`).

- [ ] **Step 1: Write the failing test**

Create `tests/test_png_info.py`:

```python
from PIL import Image
from nodes.civitai_metadata.png_info import build_pnginfo


def _roundtrip(info, tmp_path):
    p = tmp_path / "img.png"
    Image.new("RGB", (2, 2)).save(str(p), pnginfo=info)
    return Image.open(str(p)).text


def test_parameters_only(tmp_path):
    text = _roundtrip(build_pnginfo("hello params"), tmp_path)
    assert text["parameters"] == "hello params"
    assert "workflow" not in text
    assert "prompt" not in text


def test_with_workflow_and_prompt(tmp_path):
    info = build_pnginfo("p", extra_pnginfo={"workflow": {"nodes": []}}, prompt={"1": {"class_type": "X"}})
    text = _roundtrip(info, tmp_path)
    assert text["parameters"] == "p"
    assert '"nodes"' in text["workflow"]
    assert '"class_type"' in text["prompt"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_png_info.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Create `nodes/civitai_metadata/png_info.py`**

```python
# PNG text-chunk builder — part of ComfyUI-AI2Go-Utils. GPL-3.0.
#
# Always writes the A1111 `parameters` chunk (what Civitai reads). Optionally also writes ComfyUI's
# native `prompt` + `workflow` chunks (when the node's save_workflow toggle is on) so the PNG stays
# drag-and-drop reproducible in ComfyUI.
import json

from PIL.PngImagePlugin import PngInfo


def build_pnginfo(parameters, *, extra_pnginfo=None, prompt=None):
    info = PngInfo()
    info.add_text("parameters", parameters)
    if prompt is not None:
        info.add_text("prompt", json.dumps(prompt))
    if extra_pnginfo:
        for key, value in extra_pnginfo.items():
            info.add_text(key, json.dumps(value))
    return info
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_png_info.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add nodes/civitai_metadata/png_info.py tests/test_png_info.py
git commit -m "feat: PNG metadata builder (parameters + optional workflow/prompt)"
```

---

### Task 6: Tracer — sampler detection & field reading

Builds `nodes/civitai_metadata/tracer.py` incrementally (this task: find the sampler and read its scalar fields). Tasks 7 and 8 extend the same file.

**Files:**
- Create: `nodes/civitai_metadata/tracer.py`
- Test: `tests/test_tracer_sampler.py`

**Interfaces:**
- Produces:
  - `@dataclass TraceResult` with fields: `positive:str=""`, `negative:str=""`, `steps=None`, `cfg=None`, `seed=None`, `sampler_name=None`, `scheduler=None`, `denoise=None`, `clip_skip=None`, `model_name=None`, `model_file=None`, `loras:list`, `unresolved:list`.
  - `trace(prompt: dict, node_id: str) -> TraceResult` (this task: resolves sampler + scalar fields only; prompts/model filled in later tasks).
  - Module constants `SAMPLER_CLASSES`, and helpers `_node`, `_input`, `_is_link` used by later tasks.

- [ ] **Step 1: Write the failing test**

Create `tests/test_tracer_sampler.py`:

```python
from nodes.civitai_metadata.tracer import trace


def _prompt(sampler_extra=None, images_link=("6", 0)):
    sampler = {
        "class_type": "KSampler",
        "inputs": {"model": ["1", 0], "positive": ["2", 0], "negative": ["3", 0],
                   "latent_image": ["5", 0], "seed": 12345, "steps": 30, "cfg": 6.5,
                   "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0},
    }
    if sampler_extra:
        sampler["inputs"].update(sampler_extra)
    return {
        "4": sampler,
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0], "vae": ["1", 2]}},
        "7": {"class_type": "AI2GoSaveCivitaiMetadata",
              "inputs": {"images": list(images_link), "filename_prefix": "AI2Go", "save_workflow": False}},
    }


def test_finds_sampler_via_image_trace():
    r = trace(_prompt(), "7")
    assert r.steps == 30 and r.cfg == 6.5 and r.seed == 12345
    assert r.sampler_name == "dpmpp_2m" and r.scheduler == "karras" and r.denoise == 1.0
    assert "sampler" not in r.unresolved


def test_ksampler_advanced_noise_seed():
    p = _prompt()
    p["4"]["class_type"] = "KSamplerAdvanced"
    del p["4"]["inputs"]["seed"]
    p["4"]["inputs"]["noise_seed"] = 777
    assert trace(p, "7").seed == 777


def test_single_sampler_fallback_when_image_trace_dead_ends():
    p = _prompt(images_link=("99", 0))  # images point at a node that doesn't reach the sampler
    p["99"] = {"class_type": "SomePassThrough", "inputs": {"x": 1}}
    assert trace(p, "7").steps == 30  # only one sampler in graph -> used


def test_no_sampler_marks_unresolved():
    p = {"7": {"class_type": "AI2GoSaveCivitaiMetadata", "inputs": {"images": ["6", 0]}}}
    assert "sampler" in trace(p, "7").unresolved
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_tracer_sampler.py -v`
Expected: FAIL — `ModuleNotFoundError`

- [ ] **Step 3: Create `nodes/civitai_metadata/tracer.py`**

```python
# Static graph tracer over the ComfyUI API prompt — part of ComfyUI-AI2Go-Utils. GPL-3.0.
#
# Walks the API prompt (dict of {node_id: {class_type, inputs}}) backward from a save node's `images`
# input to recover the real generation parameters used this run. Mirrored in
# web/js/save_civitai_metadata.js — keep the two in sync.
#
# This file is built up across three concerns: (1) sampler detection + scalar fields, (2) prompt
# resolution (incl. our AI2GoPromptBatch), (3) the model/LoRA chain.
from dataclasses import dataclass, field

SAMPLER_CLASSES = {"KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced"}


@dataclass
class TraceResult:
    positive: str = ""
    negative: str = ""
    steps: object = None
    cfg: object = None
    seed: object = None
    sampler_name: str = None
    scheduler: str = None
    denoise: object = None
    clip_skip: object = None
    model_name: str = None
    model_file: str = None
    loras: list = field(default_factory=list)
    unresolved: list = field(default_factory=list)


def _node(prompt, node_id):
    if node_id is None:
        return None
    return prompt.get(str(node_id))


def _input(prompt, node_id, name):
    node = _node(prompt, node_id)
    if not node:
        return None
    return node.get("inputs", {}).get(name)


def _is_link(v):
    return isinstance(v, list) and len(v) == 2 and isinstance(v[1], int)


def _find_sampler(prompt, start_id):
    """BFS backward over input links from start_id to the nearest sampler node."""
    seen = set()
    queue = [str(start_id)]
    while queue:
        nid = queue.pop(0)
        if nid in seen:
            continue
        seen.add(nid)
        node = _node(prompt, nid)
        if not node:
            continue
        if node.get("class_type") in SAMPLER_CLASSES:
            return nid, node
        for v in node.get("inputs", {}).values():
            if _is_link(v):
                queue.append(str(v[0]))
    return None, None


def _single_sampler(prompt):
    found = [(nid, n) for nid, n in prompt.items() if n.get("class_type") in SAMPLER_CLASSES]
    return found[0] if len(found) == 1 else (None, None)


def _read_sampler_fields(sampler, r):
    ins = sampler.get("inputs", {})

    def lit(name):
        v = ins.get(name)
        return None if _is_link(v) else v

    r.steps = lit("steps")
    r.cfg = lit("cfg")
    r.seed = lit("seed") if lit("seed") is not None else lit("noise_seed")
    r.sampler_name = lit("sampler_name")
    r.scheduler = lit("scheduler")
    r.denoise = lit("denoise")
    for f in ("steps", "cfg", "sampler_name"):
        if getattr(r, f) is None:
            r.unresolved.append(f)


def trace(prompt, node_id):
    r = TraceResult()
    prompt = prompt or {}

    images = _input(prompt, node_id, "images")
    start = str(images[0]) if _is_link(images) else None

    sid, sampler = (None, None)
    if start is not None:
        sid, sampler = _find_sampler(prompt, start)
    if sampler is None:
        sid, sampler = _single_sampler(prompt)
    if sampler is None:
        r.unresolved.append("sampler")
        return r

    _read_sampler_fields(sampler, r)
    # Tasks 7 & 8 extend trace() here: _resolve_prompts(prompt, sampler, r) and
    # _trace_model_chain(prompt, sampler, r).
    return r
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_tracer_sampler.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add nodes/civitai_metadata/tracer.py tests/test_tracer_sampler.py
git commit -m "feat: tracer sampler detection and field reading"
```

---

### Task 7: Tracer — prompt resolution (static, batch node, unresolved)

Extends `nodes/civitai_metadata/tracer.py`.

**Files:**
- Modify: `nodes/civitai_metadata/tracer.py`
- Test: `tests/test_tracer_prompts.py`

**Interfaces:**
- Consumes: `nodes.prompt_batch_core.parse_prompts`, `select_prompt` (Task 1); tracer helpers from Task 6.
- Produces: after `trace()`, `TraceResult.positive` / `.negative` are filled; unresolvable prompt fields are appended to `.unresolved`. New constants `CLIP_ENCODE_CLASSES`, `BATCH_CLASS`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_tracer_prompts.py`:

```python
import json
from nodes.civitai_metadata.tracer import trace

CKPT = {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "myCkpt.safetensors"}}
SAVE = {"class_type": "AI2GoSaveCivitaiMetadata", "inputs": {"images": ["6", 0]}}
VAE = {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0]}}


def _ksampler(pos_text, neg_text):
    return {
        "1": CKPT,
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": pos_text, "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": neg_text, "clip": ["1", 1]}},
        "4": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0],
              "negative": ["3", 0], "seed": 1, "steps": 20, "cfg": 7,
              "sampler_name": "euler", "scheduler": "normal"}},
        "6": VAE, "7": SAVE,
    }


def test_static_clip_text():
    r = trace(_ksampler("a fox", "blurry"), "7")
    assert r.positive == "a fox" and r.negative == "blurry"
    assert "positive" not in r.unresolved and "negative" not in r.unresolved


def test_prompt_from_batch_node_at_index():
    p = _ksampler(["10", 0], ["10", 1])  # both CLIP text inputs come from the batch node
    p["10"] = {"class_type": "AI2GoPromptBatch", "inputs": {
        "prompts_json": json.dumps([{"positive": "fox", "negative": "blur"},
                                    {"positive": "city", "negative": ""}]),
        "index": 1}}
    r = trace(p, "7")
    assert r.positive == "city" and r.negative == ""


def test_unresolvable_source_flagged():
    p = _ksampler(["10", 0], "blurry")
    p["10"] = {"class_type": "SomeLLMNode", "inputs": {"seed": 5}}  # no string to read
    r = trace(p, "7")
    assert r.positive == "" and "positive" in r.unresolved
    assert r.negative == "blurry" and "negative" not in r.unresolved


def test_conditioning_passthrough_walked():
    p = _ksampler("base pos", "neg")
    # Insert a ConditioningConcat between CLIP and sampler positive.
    p["8"] = {"class_type": "ConditioningConcat", "inputs": {"conditioning_to": ["2", 0], "conditioning_from": ["2", 0]}}
    p["4"]["inputs"]["positive"] = ["8", 0]
    assert trace(p, "7").positive == "base pos"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_tracer_prompts.py -v`
Expected: FAIL — positives empty / `AttributeError` (resolution not wired yet)

- [ ] **Step 3: Extend `tracer.py`**

Add near the top constants (below `SAMPLER_CLASSES`):

```python
CLIP_ENCODE_CLASSES = {"CLIPTextEncode"}
BATCH_CLASS = "AI2GoPromptBatch"
```

Add the import at the top of the file (after the dataclass import):

```python
from ..prompt_batch_core import parse_prompts, select_prompt
```

Add these helpers (above `trace`):

```python
def _find_clip_encode(prompt, start_id):
    """BFS backward to the nearest CLIPTextEncode (walks through conditioning combiners)."""
    seen = set()
    queue = [str(start_id)]
    while queue:
        nid = queue.pop(0)
        if nid in seen:
            continue
        seen.add(nid)
        node = _node(prompt, nid)
        if not node:
            continue
        if node.get("class_type") in CLIP_ENCODE_CLASSES:
            return nid, node
        for v in node.get("inputs", {}).values():
            if _is_link(v):
                queue.append(str(v[0]))
    return None, None


def _resolve_batch(origin, slot):
    raw = origin.get("inputs", {}).get("prompts_json")
    idx = origin.get("inputs", {}).get("index", 0)
    if not isinstance(raw, str):
        return "", False
    try:
        prompts = parse_prompts(raw)
        pos, neg, _ = select_prompt(prompts, idx)
    except Exception:
        return "", False
    return (pos if slot == 0 else neg), True


def _resolve_text(prompt, clip_node):
    text = clip_node.get("inputs", {}).get("text")
    if isinstance(text, str):
        return text, True
    if not _is_link(text):
        return "", False
    oid, slot = str(text[0]), text[1]
    origin = _node(prompt, oid)
    if not origin:
        return "", False
    if origin.get("class_type") == BATCH_CLASS:
        return _resolve_batch(origin, slot)
    for v in origin.get("inputs", {}).values():  # plain primitive/string node
        if isinstance(v, str):
            return v, True
    return "", False


def _resolve_conditioning_text(prompt, sampler, which):
    link = sampler.get("inputs", {}).get(which)
    if not _is_link(link):
        return "", False
    _cid, clip = _find_clip_encode(prompt, str(link[0]))
    if clip is None:
        return "", False
    return _resolve_text(prompt, clip)


def _resolve_prompts(prompt, sampler, r):
    r.positive, ok_p = _resolve_conditioning_text(prompt, sampler, "positive")
    r.negative, ok_n = _resolve_conditioning_text(prompt, sampler, "negative")
    if not ok_p:
        r.unresolved.append("positive")
    if not ok_n:
        r.unresolved.append("negative")
```

In `trace()`, replace the `# Tasks 7 & 8 extend trace() here` comment with:

```python
    _resolve_prompts(prompt, sampler, r)
    # Task 8 extends here: _trace_model_chain(prompt, sampler, r).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python -m pytest tests/test_tracer_prompts.py tests/test_tracer_sampler.py -v`
Expected: PASS (all)

- [ ] **Step 5: Commit**

```bash
git add nodes/civitai_metadata/tracer.py tests/test_tracer_prompts.py
git commit -m "feat: tracer prompt resolution incl. Prompt Batch at run index"
```

---

### Task 8: Tracer — model & LoRA chain

Extends `nodes/civitai_metadata/tracer.py`.

**Files:**
- Modify: `nodes/civitai_metadata/tracer.py`
- Test: `tests/test_tracer_model.py`

**Interfaces:**
- Produces: after `trace()`, `TraceResult.model_name`/`.model_file` set and `.loras` is a `list[dict]` `{name, strength, file}` in load order (checkpoint→sampler). New constants `CHECKPOINT_CLASSES`, `LORA_CLASSES`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_tracer_model.py`:

```python
from nodes.civitai_metadata.tracer import trace


def _base():
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sub/myCkpt.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "pos", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "neg", "clip": ["1", 1]}},
        "4": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0],
              "negative": ["3", 0], "seed": 1, "steps": 20, "cfg": 7,
              "sampler_name": "euler", "scheduler": "normal"}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0]}},
        "7": {"class_type": "AI2GoSaveCivitaiMetadata", "inputs": {"images": ["6", 0]}},
    }


def test_no_lora_checkpoint_name():
    r = trace(_base(), "7")
    assert r.model_name == "myCkpt" and r.model_file == "sub/myCkpt.safetensors"
    assert r.loras == []


def test_lora_chain_in_load_order():
    p = _base()
    p["8"] = {"class_type": "LoraLoader", "inputs": {"model": ["1", 0], "clip": ["1", 1],
              "lora_name": "A.safetensors", "strength_model": 0.8, "strength_clip": 0.8}}
    p["9"] = {"class_type": "LoraLoader", "inputs": {"model": ["8", 0], "clip": ["8", 1],
              "lora_name": "B.safetensors", "strength_model": 0.5, "strength_clip": 0.5}}
    p["4"]["inputs"]["model"] = ["9", 0]  # sampler <- B <- A <- checkpoint
    r = trace(p, "7")
    assert r.model_name == "myCkpt"
    assert [(lo["name"], lo["strength"], lo["file"]) for lo in r.loras] == [
        ("A", 0.8, "A.safetensors"), ("B", 0.5, "B.safetensors")]


def test_model_only_lora_and_passthrough():
    p = _base()
    p["8"] = {"class_type": "ModelSamplingDiscrete", "inputs": {"model": ["10", 0], "sampling": "eps"}}
    p["10"] = {"class_type": "LoraLoaderModelOnly", "inputs": {"model": ["1", 0],
               "lora_name": "C.safetensors", "strength_model": 1.0}}
    p["4"]["inputs"]["model"] = ["8", 0]  # sampler <- passthrough <- C <- checkpoint
    r = trace(p, "7")
    assert [lo["name"] for lo in r.loras] == ["C"]
    assert r.model_name == "myCkpt"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest tests/test_tracer_model.py -v`
Expected: FAIL — `r.model_name is None`, `r.loras == []`

- [ ] **Step 3: Extend `tracer.py`**

Add constants near the top (below `BATCH_CLASS`):

```python
CHECKPOINT_CLASSES = {"CheckpointLoaderSimple", "CheckpointLoader", "unCLIPCheckpointLoader"}
LORA_CLASSES = {"LoraLoader", "LoraLoaderModelOnly"}
```

Add an `import os` at the top (with the other imports), and these helpers (above `trace`):

```python
def _stem(name):
    return os.path.splitext(os.path.basename(str(name).replace("\\", "/")))[0]


def _trace_model_chain(prompt, sampler, r):
    model = sampler.get("inputs", {}).get("model")
    nid = str(model[0]) if _is_link(model) else None
    seen = set()
    while nid and nid not in seen:
        seen.add(nid)
        node = _node(prompt, nid)
        if not node:
            break
        cls = node.get("class_type")
        ins = node.get("inputs", {})
        if cls in LORA_CLASSES:
            name = ins.get("lora_name")
            strength = ins.get("strength_model", ins.get("strength"))
            if isinstance(name, str):
                r.loras.append({"name": _stem(name),
                                "strength": None if _is_link(strength) else strength,
                                "file": name})
            nxt = ins.get("model")
            nid = str(nxt[0]) if _is_link(nxt) else None
            continue
        if cls in CHECKPOINT_CLASSES:
            ck = ins.get("ckpt_name")
            if isinstance(ck, str):
                r.model_name = _stem(ck)
                r.model_file = ck
            break
        nxt = ins.get("model")  # pass-through node (e.g. ModelSamplingDiscrete)
        nid = str(nxt[0]) if _is_link(nxt) else None
    r.loras.reverse()  # collected sampler->checkpoint; emit in load order
```

In `trace()`, replace the `# Task 8 extends here` comment with:

```python
    _trace_model_chain(prompt, sampler, r)
```

- [ ] **Step 4: Run the whole engine test suite**

Run: `python -m pytest tests/ -v`
Expected: PASS (all tracer + engine tests)

- [ ] **Step 5: Commit**

```bash
git add nodes/civitai_metadata/tracer.py tests/test_tracer_model.py
git commit -m "feat: tracer model/LoRA chain resolution"
```

---

### Task 9: The two node classes + registration

**Files:**
- Create: `nodes/save_civitai_metadata.py`
- Modify: `__init__.py` (register both nodes)
- Test: `tests/test_nodes_integration.py` (guarded by `pytest.importorskip("comfy_api")`)

**Interfaces:**
- Consumes: `trace`, `TraceResult` (tracer); `to_a1111_sampler`; `format_parameters`; `HashCache`; `build_pnginfo`; ComfyUI `io`, `ui`, `folder_paths`, `args`, `PromptServer`.
- Produces: `AI2GoSaveCivitaiMetadata`, `AI2GoSaveCivitaiMetadataAdvanced` (io.ComfyNode subclasses) + a shared `_save_with_metadata(cls, images, filename_prefix, save_workflow, overrides)` classmethod.

- [ ] **Step 1: Create `nodes/save_civitai_metadata.py`**

```python
# Save Metadata (Civitai) nodes — part of ComfyUI-AI2Go-Utils. GPL-3.0.
#
# Two output nodes that save PNG(s) with the A1111 `parameters` chunk Civitai reads (see the design at
# docs/superpowers/specs/2026-07-12-save-civitai-metadata-design.md). Basic auto-traces the graph;
# Advanced adds override sockets for the volatile fields. The graph tracer is mirrored in
# web/js/save_civitai_metadata.js (the Test button) — keep the two in sync.
import os
import logging

import numpy as np
from PIL import Image

import folder_paths
from comfy.cli_args import args
from comfy_api.latest import io, ui

try:
    from server import PromptServer
except Exception:  # pragma: no cover - server always present in ComfyUI, guarded for safety
    PromptServer = None

from .civitai_metadata.tracer import trace
from .civitai_metadata.sampler_names import to_a1111_sampler
from .civitai_metadata.a1111 import format_parameters
from .civitai_metadata.hashing import HashCache
from .civitai_metadata.png_info import build_pnginfo

logger = logging.getLogger(__name__)

# Persistent AutoV2 hash cache lives in the pack root (git-ignored).
_CACHE_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), ".hash_cache.json")

# Override keys the Advanced node can supply; each maps to a TraceResult attribute.
_OVERRIDE_KEYS = ("positive", "negative", "steps", "cfg", "seed", "sampler_name", "scheduler")


def _save_with_metadata(cls, images, filename_prefix, save_workflow, overrides):
    """Shared engine call + PNG save for both nodes. Returns an io.NodeOutput."""
    prompt = cls.hidden.prompt or {}
    result = trace(prompt, cls.hidden.unique_id)

    # Advanced overrides: a supplied (non-None) socket value wins over the trace.
    for key in _OVERRIDE_KEYS:
        val = (overrides or {}).get(key)
        if val is not None and val != "":
            setattr(result, key, val)
            if key in result.unresolved:
                result.unresolved.remove(key)

    # Resolve model + LoRA file paths to AutoV2 hashes (cached).
    cache = HashCache(_CACHE_PATH)
    model_hash = cache.get(folder_paths.get_full_path("checkpoints", result.model_file)) if result.model_file else None
    for lo in result.loras:
        path = folder_paths.get_full_path("loras", lo["file"]) if lo.get("file") else None
        lo["hash"] = cache.get(path) if path else None

    height, width = int(images[0].shape[0]), int(images[0].shape[1])
    sampler_label = to_a1111_sampler(result.sampler_name or "", result.scheduler or "")
    parameters = format_parameters(
        positive=result.positive, negative=result.negative, steps=result.steps, cfg=result.cfg,
        seed=result.seed, sampler=sampler_label, width=width, height=height,
        model_name=result.model_name, model_hash=model_hash, loras=result.loras,
        denoise=result.denoise, clip_skip=result.clip_skip,
    )

    full_output_folder, filename, counter, subfolder, filename_prefix = folder_paths.get_save_image_path(
        filename_prefix, folder_paths.get_output_directory(), width, height)

    results = []
    for batch_number, image in enumerate(images):
        arr = 255.0 * image.cpu().numpy()
        img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))
        info = None
        if not args.disable_metadata:
            info = build_pnginfo(
                parameters,
                extra_pnginfo=(cls.hidden.extra_pnginfo if save_workflow else None),
                prompt=(cls.hidden.prompt if save_workflow else None),
            )
        fname = filename.replace("%batch_num%", str(batch_number))
        file = f"{fname}_{counter:05}_.png"
        img.save(os.path.join(full_output_folder, file), pnginfo=info, compress_level=4)
        results.append(ui.SavedResult(filename=file, subfolder=subfolder, type=io.FolderType.output))
        counter += 1

    if result.unresolved:
        msg = "AI2Go Save Metadata: unresolved fields -> %s (use the Advanced node's sockets)"
        logger.warning(msg, ", ".join(result.unresolved))
        if PromptServer is not None and cls.hidden.unique_id is not None:
            try:
                PromptServer.instance.send_progress_text(
                    "⚠ unresolved: " + ", ".join(result.unresolved), cls.hidden.unique_id)
            except Exception:
                pass

    return io.NodeOutput(images, ui={"images": results})


_METADATA_DESC = (
    "Save PNG(s) with A1111-style metadata Civitai can read (positive/negative, steps, CFG, sampler, "
    "seed, size, model + LoRA AutoV2 hashes). Auto-traces the KSampler from the saved image — including "
    "our Prompt Batch node's actual line for this run. save_workflow (off) additionally embeds the "
    "ComfyUI workflow like the stock Save Image."
)


class AI2GoSaveCivitaiMetadata(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="AI2GoSaveCivitaiMetadata",
            display_name="AI2Go Save Metadata (Civitai)",
            category="AI2Go/image",
            search_aliases=["save", "civitai", "metadata", "a1111", "parameters", "png"],
            is_output_node=True,
            is_experimental=True,
            description=_METADATA_DESC,
            inputs=[
                io.Image.Input("images", tooltip="Images to save."),
                io.String.Input("filename_prefix", default="AI2Go",
                                tooltip="Filename prefix (supports %date:...% tokens like Save Image)."),
                io.Boolean.Input("save_workflow", default=False,
                                 tooltip="Also embed the ComfyUI workflow/prompt chunks (off = only the "
                                         "Civitai `parameters` chunk)."),
            ],
            outputs=[io.Image.Output(display_name="images")],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo, io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, images, filename_prefix="AI2Go", save_workflow=False) -> io.NodeOutput:
        return _save_with_metadata(cls, images, filename_prefix, save_workflow, overrides=None)


class AI2GoSaveCivitaiMetadataAdvanced(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="AI2GoSaveCivitaiMetadataAdvanced",
            display_name="AI2Go Save Metadata (Civitai) Advanced",
            category="AI2Go/image",
            search_aliases=["save", "civitai", "metadata", "a1111", "parameters", "png", "advanced"],
            is_output_node=True,
            is_experimental=True,
            description=_METADATA_DESC + " Advanced: wire positive/negative (and optionally the sampler "
                        "settings) to override the trace — the reliable path for dynamic prompts.",
            inputs=[
                io.Image.Input("images", tooltip="Images to save."),
                io.String.Input("filename_prefix", default="AI2Go",
                                tooltip="Filename prefix (supports %date:...% tokens like Save Image)."),
                io.Boolean.Input("save_workflow", default=False,
                                 tooltip="Also embed the ComfyUI workflow/prompt chunks (off = only the "
                                         "Civitai `parameters` chunk)."),
                io.String.Input("positive", optional=True, force_input=True,
                                tooltip="Override positive prompt (wire the Prompt Batch 'positive' output)."),
                io.String.Input("negative", optional=True, force_input=True,
                                tooltip="Override negative prompt (wire the Prompt Batch 'negative' output)."),
                io.Int.Input("steps", optional=True, force_input=True, tooltip="Override steps."),
                io.Float.Input("cfg", optional=True, force_input=True, tooltip="Override CFG scale."),
                io.Int.Input("seed", optional=True, force_input=True, tooltip="Override seed."),
                io.String.Input("sampler_name", optional=True, force_input=True, tooltip="Override sampler name."),
                io.String.Input("scheduler", optional=True, force_input=True, tooltip="Override scheduler."),
            ],
            outputs=[io.Image.Output(display_name="images")],
            hidden=[io.Hidden.prompt, io.Hidden.extra_pnginfo, io.Hidden.unique_id],
        )

    @classmethod
    def execute(cls, images, filename_prefix="AI2Go", save_workflow=False, positive=None, negative=None,
                steps=None, cfg=None, seed=None, sampler_name=None, scheduler=None) -> io.NodeOutput:
        overrides = {"positive": positive, "negative": negative, "steps": steps, "cfg": cfg,
                     "seed": seed, "sampler_name": sampler_name, "scheduler": scheduler}
        return _save_with_metadata(cls, images, filename_prefix, save_workflow, overrides=overrides)
```

- [ ] **Step 2: Register both nodes in `__init__.py`**

Modify `__init__.py`: add the import and both mapping entries.

```python
from .nodes.save_civitai_metadata import AI2GoSaveCivitaiMetadata, AI2GoSaveCivitaiMetadataAdvanced
```

In `NODE_CLASS_MAPPINGS` add:

```python
    "AI2GoSaveCivitaiMetadata": AI2GoSaveCivitaiMetadata,
    "AI2GoSaveCivitaiMetadataAdvanced": AI2GoSaveCivitaiMetadataAdvanced,
```

In `NODE_DISPLAY_NAME_MAPPINGS` add:

```python
    "AI2GoSaveCivitaiMetadata": "AI2Go Save Metadata (Civitai)",
    "AI2GoSaveCivitaiMetadataAdvanced": "AI2Go Save Metadata (Civitai) Advanced",
```

- [ ] **Step 3: Write an import-guarded integration test**

Create `tests/test_nodes_integration.py`. It is skipped automatically when ComfyUI isn't importable, and exercises the full save path when it is.

```python
import os
import pytest

pytest.importorskip("comfy_api")  # only runs inside a ComfyUI environment
import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402


def test_basic_node_writes_parameters_chunk(tmp_path, monkeypatch):
    import folder_paths
    from nodes.save_civitai_metadata import AI2GoSaveCivitaiMetadata as Node

    monkeypatch.setattr(folder_paths, "get_output_directory", lambda: str(tmp_path))
    monkeypatch.setattr(folder_paths, "get_full_path", lambda kind, name: None)  # skip hashing

    prompt = {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "m.safetensors"}},
        "2": {"class_type": "CLIPTextEncode", "inputs": {"text": "a fox", "clip": ["1", 1]}},
        "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "blur", "clip": ["1", 1]}},
        "4": {"class_type": "KSampler", "inputs": {"model": ["1", 0], "positive": ["2", 0],
              "negative": ["3", 0], "seed": 42, "steps": 25, "cfg": 7.0,
              "sampler_name": "euler", "scheduler": "normal"}},
        "6": {"class_type": "VAEDecode", "inputs": {"samples": ["4", 0]}},
        "7": {"class_type": "AI2GoSaveCivitaiMetadata", "inputs": {"images": ["6", 0]}},
    }

    class _Hidden:
        prompt = prompt
        extra_pnginfo = {"workflow": {"nodes": []}}
        unique_id = "7"

    monkeypatch.setattr(Node, "hidden", _Hidden, raising=False)

    import torch
    images = torch.zeros((1, 64, 48, 3))  # [batch, H, W, C]
    Node.execute(images, filename_prefix="AI2GoTest", save_workflow=False)

    pngs = list(tmp_path.glob("AI2GoTest_*.png"))
    assert pngs, "no PNG written"
    text = Image.open(str(pngs[0])).text
    params = text["parameters"]
    assert params.startswith("a fox")
    assert "Negative prompt: blur" in params
    assert "Steps: 25" in params and "Seed: 42" in params and "Size: 48x64" in params
    assert "workflow" not in text  # save_workflow was off
```

- [ ] **Step 4: Run the integration test**

Run (in a shell where ComfyUI is importable, e.g. its venv with repo root on `PYTHONPATH`):
`python -m pytest tests/test_nodes_integration.py -v`
Expected: PASS, or SKIPPED if `comfy_api` isn't importable in the current environment. Either is acceptable at this step — the manual verification below is the real gate.

- [ ] **Step 5: Manual verification in ComfyUI**

Restart the ComfyUI server (Python changed — per repo memory `comfyui-reload-loop`). Build a minimal graph: CheckpointLoaderSimple → two CLIPTextEncode → KSampler → VAEDecode → **AI2Go Save Metadata (Civitai)**. Queue it. Then inspect the saved PNG:

```bash
python -c "from PIL import Image; print(Image.open(r'PATH_TO_OUTPUT.png').text['parameters'])"
```

Confirm the positive, `Negative prompt:`, `Steps/Sampler/CFG scale/Seed/Size/Model` line appear, and that `workflow` is absent. Toggle `save_workflow` on, re-run, confirm a `workflow` chunk now appears.

- [ ] **Step 6: Commit**

```bash
git add nodes/save_civitai_metadata.py __init__.py tests/test_nodes_integration.py
git commit -m "feat: Save Metadata (Civitai) Basic + Advanced nodes"
```

---

### Task 10: Front-end Test-detection button + JS tracer mirror

**Files:**
- Create: `web/js/save_civitai_metadata.js`
- Test: manual (browser load) — ESM per repo memory.

**Interfaces:**
- Consumes: `web/js/utility.js` `chainCallback`; the live graph via `app.graph`. Mirrors `nodes/civitai_metadata/tracer.py`.
- Produces: a `🔎 Test detection` button + read-only preview panel on both node types.

- [ ] **Step 1: Create `web/js/save_civitai_metadata.js`**

```javascript
/*
 * Part of ComfyUI-AI2Go-Utils. GPL-3.0, like the rest of the pack.
 *
 * Front-end for the AI2Go Save Metadata (Civitai) nodes. Adds a "🔎 Test detection" button that runs
 * the SAME backward graph trace as nodes/civitai_metadata/tracer.py (image -> sampler -> CLIPTextEncode
 * / AI2GoPromptBatch, and model -> LoraLoader* -> Checkpoint) against the LIVE graph, and shows what
 * save will write. Hashes are computed on save (no file access here). Keep this trace in sync with the
 * Python tracer — the two are a mirror pair, like parsePrompts <-> _parse_prompts.
 */
import { chainCallback } from "./utility.js";
const { app } = window.comfyAPI.app;

const NODE_IDS = ["AI2GoSaveCivitaiMetadata", "AI2GoSaveCivitaiMetadataAdvanced"];
const SAMPLER_CLASSES = new Set(["KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced"]);
const CLIP_CLASSES = new Set(["CLIPTextEncode"]);
const CHECKPOINT_CLASSES = new Set(["CheckpointLoaderSimple", "CheckpointLoader", "unCLIPCheckpointLoader"]);
const LORA_CLASSES = new Set(["LoraLoader", "LoraLoaderModelOnly"]);
const BATCH_CLASS = "AI2GoPromptBatch";

// --- Live-graph link helpers (LiteGraph). node.inputs[i].link -> graph.links[id] -> {origin_id, origin_slot}.
function inputLink(node, name) {
  const inp = (node.inputs || []).find((i) => i.name === name);
  if (!inp || inp.link == null) return null;
  const links = node.graph?.links;
  const link = links?.get ? links.get(inp.link) : links?.[inp.link];
  return link || null;
}
function originNode(node, name) {
  const link = inputLink(node, name);
  return link ? node.graph.getNodeById(link.origin_id) : null;
}
function widget(node, name) {
  return node.widgets?.find((w) => w.name === name)?.value;
}
const stem = (s) => String(s).replace(/\\/g, "/").split("/").pop().replace(/\.[^.]+$/, "");

function bfsBack(node, classSet) {
  const seen = new Set();
  const queue = [node];
  while (queue.length) {
    const n = queue.shift();
    if (!n || seen.has(n.id)) continue;
    seen.add(n.id);
    if (classSet.has(n.comfyClass || n.type)) return n;
    for (const inp of n.inputs || []) {
      const o = originNode(n, inp.name);
      if (o) queue.push(o);
    }
  }
  return null;
}

// Resolve a CLIPTextEncode's text: static widget, our batch node (by output slot), or a plain string node.
function resolveClipText(node) {
  const t = widget(node, "text");
  if (typeof t === "string") return { text: t, ok: true };
  const link = inputLink(node, "text");
  if (!link) return { text: "", ok: false };
  const origin = node.graph.getNodeById(link.origin_id);
  if (!origin) return { text: "", ok: false };
  if ((origin.comfyClass || origin.type) === BATCH_CLASS) {
    // Live batch node: prefer its current rows at the current index; fall back to prompts_json.
    const idx = parseInt(widget(origin, "index"), 10) || 0;
    let rows = origin._pbRows;
    if (!rows) {
      try { rows = JSON.parse(widget(origin, "prompts_json") || "[]"); } catch { rows = []; }
    }
    if (!rows.length) return { text: "", ok: false };
    const row = rows[Math.max(0, Math.min(idx, rows.length - 1))];
    const slot = link.origin_slot; // 0 = positive, 1 = negative
    return { text: slot === 1 ? (row.negative || "") : (row.positive || ""), ok: true };
  }
  for (const w of origin.widgets || []) {
    if (typeof w.value === "string" && w.value.trim()) return { text: w.value, ok: true };
  }
  return { text: "", ok: false };
}

function traceLive(node) {
  const r = { positive: "", negative: "", steps: null, cfg: null, seed: null, sampler_name: null,
              scheduler: null, model_name: null, loras: [], unresolved: [] };
  let sampler = originNode(node, "images") ? bfsBack(originNode(node, "images"), SAMPLER_CLASSES) : null;
  if (!sampler) {
    const all = (node.graph?._nodes || []).filter((n) => SAMPLER_CLASSES.has(n.comfyClass || n.type));
    sampler = all.length === 1 ? all[0] : null;
  }
  if (!sampler) { r.unresolved.push("sampler"); return r; }

  r.steps = widget(sampler, "steps");
  r.cfg = widget(sampler, "cfg");
  r.seed = widget(sampler, "seed") ?? widget(sampler, "noise_seed");
  r.sampler_name = widget(sampler, "sampler_name");
  r.scheduler = widget(sampler, "scheduler");
  for (const f of ["steps", "cfg", "sampler_name"]) if (r[f] == null) r.unresolved.push(f);

  for (const which of ["positive", "negative"]) {
    const cond = originNode(sampler, which);
    const clip = cond ? bfsBack(cond, CLIP_CLASSES) : null;
    const res = clip ? resolveClipText(clip) : { text: "", ok: false };
    r[which] = res.text;
    if (!res.ok) r.unresolved.push(which);
  }

  // Model chain: walk model links back through LoraLoaders to the checkpoint.
  let cur = originNode(sampler, "model");
  const seen = new Set();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    const cls = cur.comfyClass || cur.type;
    if (LORA_CLASSES.has(cls)) {
      const name = widget(cur, "lora_name");
      if (typeof name === "string") r.loras.push({ name: stem(name), strength: widget(cur, "strength_model") });
      cur = originNode(cur, "model");
    } else if (CHECKPOINT_CLASSES.has(cls)) {
      const ck = widget(cur, "ckpt_name");
      if (typeof ck === "string") r.model_name = stem(ck);
      break;
    } else {
      cur = originNode(cur, "model");
    }
  }
  r.loras.reverse();
  return r;
}

function ensureStyles() {
  if (document.getElementById("ai2go-scm-style")) return;
  const s = document.createElement("style");
  s.id = "ai2go-scm-style";
  s.textContent = `
  .ai2go-scm{font:11.5px/1.45 -apple-system,"Segoe UI",Roboto,sans-serif;color:#d3d3d0;
    background:#1a1a19;border:1px solid #33332f;border-radius:6px;padding:7px 9px;white-space:pre-wrap;
    word-break:break-word}
  .ai2go-scm .k{color:#8b8b86}.ai2go-scm .pos{color:#5cae6d}.ai2go-scm .neg{color:#c86b6b}
  .ai2go-scm .warn{color:#e0a24e}`;
  document.head.appendChild(s);
}

function renderPreview(el, r) {
  const loras = r.loras.length ? r.loras.map((l) => `<${l.name}:${l.strength}>`).join(" ") : "(none)";
  const warn = r.unresolved.length ? `\n⚠ unresolved: ${r.unresolved.join(", ")} — wire the Advanced node's socket(s).` : "";
  el.innerHTML =
    `<span class="pos">positive</span>: ${escapeHtml(r.positive) || "(empty)"}\n` +
    `<span class="neg">negative</span>: ${escapeHtml(r.negative) || "(empty)"}\n` +
    `<span class="k">steps</span> ${r.steps} · <span class="k">cfg</span> ${r.cfg} · ` +
    `<span class="k">sampler</span> ${r.sampler_name}/${r.scheduler} · <span class="k">seed</span> ${r.seed}\n` +
    `<span class="k">model</span> ${r.model_name ?? "(?)"} · <span class="k">loras</span> ${loras}\n` +
    `<span class="k">size</span> from image at run · hashes computed on save` +
    (warn ? `<span class="warn">${escapeHtml(warn)}</span>` : "");
}
function escapeHtml(s) {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

app.registerExtension({
  name: "AI2Go.SaveCivitaiMetadata",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (!NODE_IDS.includes(nodeData?.name)) return;
    ensureStyles();
    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const node = this;
      const panel = document.createElement("div");
      panel.className = "ai2go-scm";
      panel.textContent = 'Press "🔎 Test detection" to preview what will be saved.';
      const btn = node.addWidget("button", "🔎 Test detection", null, () => {
        try { renderPreview(panel, traceLive(node)); }
        catch (e) { panel.textContent = "Trace error: " + e.message; }
        node.setDirtyCanvas?.(true, true);
      });
      btn.serialize = false;
      node.addDOMWidget("scm_preview", "info", panel, { serialize: false });
    });
  },
});
```

- [ ] **Step 2: Validate as an ES module (browser load)**

`node --check` false-passes ESM (repo memory `validate-web-js-as-esm`). Instead, hard-refresh ComfyUI in the browser and confirm the module loads with no console error, and both nodes show the `🔎 Test detection` button. If it fails to load, the browser console names the offending line.

- [ ] **Step 3: Manual verification**

On a static graph, click **Test detection** → panel shows the positive/negative/sampler/model. Wire the graph through the **AI2Go Prompt Batch** node (its `positive`/`negative` → the two CLIPTextEncode `text` inputs), set the batch index, click Test → the panel shows that index's line. Point a prompt at an unsupported node → panel shows the `⚠ unresolved` hint.

- [ ] **Step 4: Commit**

```bash
git add web/js/save_civitai_metadata.js
git commit -m "feat: Test-detection button + JS tracer mirror for Save Metadata nodes"
```

---

### Task 11: Docs, full-suite check, and Civitai verification

**Files:**
- Modify: `README.md`
- Modify: `pyproject.toml` (version bump)

**Interfaces:**
- Consumes: everything above. No new code interfaces.

- [ ] **Step 1: Document the nodes in `README.md`**

Add a section (match the existing README style — see the Prompt Batch section) describing both nodes: what the `parameters` chunk is, that Civitai reads it, the auto-trace vs. Advanced sockets, the Test button, the `save_workflow` toggle, and the one-KSampler assumption. Note the AutoV2 hashing and that the first save of a new model is slow (hashing) then cached.

- [ ] **Step 2: Bump the pack version**

In `pyproject.toml`, bump `version = "1.3.1"` to `version = "1.4.0"` (new feature).

- [ ] **Step 3: Run the entire test suite**

Run: `python -m pytest tests/ -v`
Expected: PASS for all engine/unit tests; the integration test PASSES or is SKIPPED depending on environment.

- [ ] **Step 4: Civitai hash verification (the one external unknown)**

Generate an image through the Basic node with a real checkpoint + at least one LoRA. Upload the PNG to Civitai (or use its metadata reader) and confirm the checkpoint and LoRA(s) are **auto-recognized** as resources. If they are not, the AutoV2 flavor is wrong — adjust `sha256_autov2` in `nodes/civitai_metadata/hashing.py` (e.g. try the legacy AutoV1 short hash) and re-verify. This is a localized change; the formatter only receives hash strings. Record the outcome.

- [ ] **Step 5: Commit**

```bash
git add README.md pyproject.toml
git commit -m "docs: document Save Metadata (Civitai) nodes; bump to 1.4.0"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** both nodes (Tasks 9), A1111 format incl. LoRA tags + hashes (Tasks 3, 4), static tracer with Prompt Batch special-case (Tasks 6–8), Test button mirror (Task 10), `save_workflow` on both (Task 9), sampler mapping (Task 2), failure handling / unresolved reporting (Tasks 7, 9), hashing+cache (Task 4), file output (Task 9), testing (every task), Civitai verification (Task 11). No spec section is unimplemented.
- **Type consistency:** `TraceResult` field names (`sampler_name`, `model_file`, `loras[].file/.name/.strength/.hash`) are used identically in Tasks 6→9; `_OVERRIDE_KEYS` matches the Advanced `execute` params and the `TraceResult` attributes; `format_parameters` kwargs match the call site in `_save_with_metadata`.
- **Mirror:** the JS `traceLive` walk (Task 10) matches the Python `trace` walk (Tasks 6–8): same class sets, same slot-0/1 batch convention, same load-order `reverse()`.
