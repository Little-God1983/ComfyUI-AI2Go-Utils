# Static graph tracer over the ComfyUI API prompt — part of ComfyUI-AI2Go-Utils. GPL-3.0.
#
# Walks the API prompt (dict of {node_id: {class_type, inputs}}) backward from a save node's `images`
# input to recover the real generation parameters used this run. Mirrored in
# web/js/save_civitai_metadata.js — keep the two in sync.
#
# This file is built up across three concerns: (1) sampler detection + scalar fields, (2) prompt
# resolution (incl. our AI2GoPromptBatch), (3) the model/LoRA chain.
from dataclasses import dataclass, field

from ..prompt_batch_core import parse_prompts, select_prompt

SAMPLER_CLASSES = {"KSampler", "KSamplerAdvanced", "SamplerCustom", "SamplerCustomAdvanced"}
CLIP_ENCODE_CLASSES = {"CLIPTextEncode"}
BATCH_CLASS = "AI2GoPromptBatch"


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
    _resolve_prompts(prompt, sampler, r)
    # Task 8 extends here: _trace_model_chain(prompt, sampler, r).
    return r
