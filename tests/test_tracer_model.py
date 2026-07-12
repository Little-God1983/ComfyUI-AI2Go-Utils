# Tests for tracer model/LoRA chain — part of ComfyUI-AI2Go-Utils. GPL-3.0.
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
