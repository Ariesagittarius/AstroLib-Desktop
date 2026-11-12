"""
src/server/plugins/bilingual-aligner/qwen-runner.py
=============================================================================
AstroLib Qwen3-Embedding-0.6B Dedicated Offline Inference Runner
=============================================================================
Architecture:
- CausalLM 0.6B (Qwen/Qwen3-Embedding-0.6B), 1024-dim representation
- Last-Token Pooling with L2 unit hypersphere normalization
- GPU (CUDA) acceleration with automatic CPU fallback
- Zero-bandwidth guard: Strictly offline (local_files_only=True)
- JSON-RPC over stdin/stdout for persistent daemon mode & CLI one-shot mode
=============================================================================
"""

import sys
import os
import json
import time

# Strictly offline execution with domestic mirror configuration
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["HF_ENDPOINT"] = "https://hf-mirror.com"

MODEL_ID = "Qwen/Qwen3-Embedding-0.6B"

_model = None
_tokenizer = None
_device = None


def load_model():
    global _model, _tokenizer, _device
    if _model is not None:
        return _model, _tokenizer, _device

    import torch
    from transformers import AutoTokenizer, AutoModel

    _device = "cuda" if torch.cuda.is_available() else "cpu"
    dtype = torch.float16 if _device == "cuda" else torch.float32

    # Attempt local cache load
    try:
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, local_files_only=True)
        _model = AutoModel.from_pretrained(MODEL_ID, local_files_only=True, dtype=dtype).to(_device)
    except Exception as e:
        # If local_files_only throws due to cache resolution, retry with mirror
        _tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
        _model = AutoModel.from_pretrained(MODEL_ID, dtype=dtype).to(_device)

    _model.eval()
    return _model, _tokenizer, _device


def embed_texts(model, tokenizer, texts, device, batch_size=16, max_length=1024):
    import torch
    import torch.nn.functional as F

    clean_texts = [t.strip()[:max_length] if (t and t.strip()) else "empty" for t in texts]
    all_embeds = []

    for i in range(0, len(clean_texts), batch_size):
        chunk = clean_texts[i:i + batch_size]
        inputs = tokenizer(
            chunk,
            padding=True,
            truncation=True,
            max_length=max_length,
            return_tensors="pt"
        ).to(device)

        with torch.no_grad():
            outputs = model(**inputs)
            # CausalLM last-token pooling
            seq_lens = inputs["attention_mask"].sum(dim=1) - 1
            pooled = outputs.last_hidden_state[torch.arange(len(chunk), device=device), seq_lens]
            normed = F.normalize(pooled.float(), p=2, dim=1)
            all_embeds.append(normed.cpu())

    if all_embeds:
        return torch.cat(all_embeds, dim=0)
    return torch.empty((0, 1024))


def run_align(source_texts, target_texts, batch_size=16):
    import torch

    t0 = time.perf_counter()
    model, tokenizer, device = load_model()

    if not source_texts or not target_texts:
        return {
            "matrix": [],
            "inferenceTimeMs": 0,
            "engine": f"qwen3-0.6b ({device})",
            "dim": 1024
        }

    e_src = embed_texts(model, tokenizer, source_texts, device, batch_size=batch_size)
    e_tgt = embed_texts(model, tokenizer, target_texts, device, batch_size=batch_size)

    sim = torch.mm(e_src, e_tgt.T)
    sim = torch.clamp(sim, 0.0, 1.0)
    matrix = [[round(float(v), 4) for v in row] for row in sim]

    inference_ms = round((time.perf_counter() - t0) * 1000)

    dev_name = "CUDA" if device == "cuda" else "CPU"
    dtype_str = "fp16" if model.dtype == torch.float16 else "fp32"

    return {
        "matrix": matrix,
        "inferenceTimeMs": inference_ms,
        "engine": f"Qwen3-Embedding-0.6B ({dev_name}/{dtype_str})",
        "modelId": "qwen3-0.6b",
        "modelName": "Qwen/Qwen3-Embedding-0.6B",
        "dim": 1024,
        "device": dev_name,
    }


def daemon_loop():
    # Force UTF-8 encoding on stdin/stdout if possible
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    # Pre-warm model into VRAM during daemon startup
    model, _, device = load_model()

    # Signal daemon ready
    sys.stdout.write(json.dumps({"status": "ready", "model": MODEL_ID, "device": device}) + "\n")
    sys.stdout.flush()

    for line in sys.stdin:
        line = line.strip().lstrip("\ufeff")
        if not line:
            continue
        try:
            req = json.loads(line)
            action = req.get("action", "align")
            req_id = req.get("id")

            if action == "ping":
                model, _, device = load_model()
                resp = {
                    "id": req_id,
                    "status": "ok",
                    "device": device,
                    "model": MODEL_ID,
                    "dim": 1024
                }
            elif action == "align":
                sources = req.get("sourceTexts", [])
                targets = req.get("targetTexts", [])
                batch_size = req.get("batchSize", 16)
                result = run_align(sources, targets, batch_size=batch_size)
                resp = {
                    "id": req_id,
                    "status": "ok",
                    **result
                }
            else:
                resp = {"id": req_id, "status": "error", "error": f"Unknown action: {action}"}

            sys.stdout.write(json.dumps(resp) + "\n")
            sys.stdout.flush()
        except Exception as e:
            sys.stdout.write(json.dumps({"status": "error", "error": str(e)}) + "\n")
            sys.stdout.flush()


def main():
    if hasattr(sys.stdin, "reconfigure"):
        sys.stdin.reconfigure(encoding="utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    if len(sys.argv) > 1 and sys.argv[1] == "--daemon":
        daemon_loop()
    elif len(sys.argv) > 1 and sys.argv[1] == "--ping":
        model, _, device = load_model()
        print(json.dumps({"status": "ok", "device": device, "model": MODEL_ID}))
    else:
        # One-shot JSON from stdin
        raw = sys.stdin.read().strip().lstrip("\ufeff")
        if raw:
            data = json.loads(raw)
            res = run_align(data.get("sourceTexts", []), data.get("targetTexts", []))
            print(json.dumps(res))
        else:
            print(json.dumps({"error": "No input provided"}))


if __name__ == "__main__":
    main()
