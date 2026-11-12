"""
src/services/info-highlight/qwen-highlight-runner.py
=============================================================================
AstroLib Qwen3-0.6B Shannon Surprisal Offline Inference Runner (InfoLens Engine)
=============================================================================
Architecture:
- AutoModelForCausalLM (Qwen3-0.6B-Base), Next-Token Condition Probability P(w_t | w_<t)
- Shannon Information Surprisal: S(w_t) = -log2(P(w_t | w_<t)) (bits)
- Dynamic Range: 0 to 18 bits (CI ratio = S / 18, 16 discrete highlight levels)
- KV-Cache Chunked Forward: Low VRAM footprint (~1.14 GB) on RTX 5060 Laptop GPU
- Zero Bandwidth / Strictly Offline: local_files_only=True
- Communication: Persistent JSON-RPC daemon over stdin/stdout for instant latency
=============================================================================
"""

import sys
import os
import io
import json
import time
import math
import argparse
from typing import List, Dict, Tuple, Optional, Any

# Ensure UTF-8 output on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', line_buffering=True)
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', line_buffering=True)

# Strictly offline
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"

ZERO_CONFIDENCE_PROBABILITY_BASELINE = 2 ** -18
MAX_SURPRISAL_BITS = 18.0

_model = None
_tokenizer = None
_device = None
_bos_logits_cache = None

DEFAULT_LOCAL_PATHS = [
    os.path.join(os.path.expanduser("~"), r".cache\modelscope\models\Qwen--Qwen3-0.6B-Base\snapshots\master"),
    r"C:\Users\白羊欣存\.cache\modelscope\models\Qwen--Qwen3-0.6B-Base\snapshots\master",
    os.path.join(os.path.expanduser("~"), r".cache\huggingface\hub\models--Qwen--Qwen3-0.6B-Base\snapshots\master"),
]


def resolve_model_path(custom_path: Optional[str] = None) -> str:
    if custom_path and os.path.exists(custom_path):
        return custom_path
    env_path = os.environ.get("QWEN_MODEL_PATH")
    if env_path and os.path.exists(env_path):
        return env_path
    for p in DEFAULT_LOCAL_PATHS:
        if os.path.exists(p):
            return p
    # Fallback to local test project directory if present
    alt = r"D:\Antigravity\project\test\InfoLens"
    if os.path.exists(alt):
        # Check inside InfoLens if cached
        pass
    raise FileNotFoundError("Local Qwen3-0.6B-Base weights not found in local cache.")


def load_model(custom_path: Optional[str] = None):
    global _model, _tokenizer, _device, _bos_logits_cache
    if _model is not None:
        return _model, _tokenizer, _device

    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM

    model_path = resolve_model_path(custom_path)
    _device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    dtype = torch.float16 if _device.type == "cuda" else torch.float32

    _tokenizer = AutoTokenizer.from_pretrained(
        model_path,
        local_files_only=True,
        trust_remote_code=True
    )

    _model = AutoModelForCausalLM.from_pretrained(
        model_path,
        local_files_only=True,
        dtype=dtype,
        trust_remote_code=True
    ).to(_device)
    _model.eval()

    # Precompute BOS logits cache for first token estimation
    bos_id = _tokenizer.bos_token_id or _tokenizer.eos_token_id or 0
    with torch.inference_mode():
        bos_tensor = torch.tensor([[bos_id]], dtype=torch.long, device=_device)
        out = _model(input_ids=bos_tensor)
        _bos_logits_cache = out.logits[0, -1].detach().cpu().float()

    return _model, _tokenizer, _device


def compute_first_token_prob(first_token_id: int) -> float:
    global _bos_logits_cache
    if _bos_logits_cache is None:
        return ZERO_CONFIDENCE_PROBABILITY_BASELINE
    import torch
    probs = torch.softmax(_bos_logits_cache, dim=-1)
    if 0 <= first_token_id < probs.shape[0]:
        return float(probs[first_token_id].item())
    return ZERO_CONFIDENCE_PROBABILITY_BASELINE


def analyze_text(text: str, chunk_size: int = 1024) -> Dict[str, Any]:
    import torch

    t0 = time.perf_counter()
    model, tokenizer, device = load_model()

    if not text or not text.strip():
        return {
            "tokens": [],
            "inputTokens": 0,
            "inferenceTimeMs": 0,
            "modelName": "Qwen3-0.6B-Base",
            "device": str(device),
        }

    # Encode with char offsets
    encoding = tokenizer(
        text,
        return_offsets_mapping=True,
        return_tensors="pt"
    )

    input_ids = encoding["input_ids"].to(device)
    offsets = encoding["offset_mapping"][0].tolist()
    seq_len = input_ids.shape[1]

    if seq_len == 0:
        return {
            "tokens": [],
            "inputTokens": 0,
            "inferenceTimeMs": 0,
            "modelName": "Qwen3-0.6B-Base",
            "device": str(device),
        }

    # Chunked inference using KV-cache to avoid peak memory explosion
    real_probs: List[float] = []
    past_key_values = None

    with torch.inference_mode():
        # First token probability via BOS prefix cache
        first_token_id = int(input_ids[0, 0].item())
        first_prob = compute_first_token_prob(first_token_id)
        real_probs.append(first_prob)

        # Subsequent tokens conditional probability P(w_t | w_<t)
        total_chunks = (seq_len + chunk_size - 1) // chunk_size
        for i in range(total_chunks):
            start_idx = i * chunk_size
            end_idx = min((i + 1) * chunk_size, seq_len)
            input_chunk = input_ids[:, start_idx:end_idx]

            outputs = model(
                input_ids=input_chunk,
                past_key_values=past_key_values,
                use_cache=True,
            )
            past_key_values = outputs.past_key_values
            logits = outputs.logits

            chunk_targets = input_ids[:, 1 + start_idx : 1 + end_idx]
            valid_len = chunk_targets.shape[1]
            if valid_len > 0:
                probs_chunk = torch.softmax(logits[:, :valid_len, :], dim=-1)
                target_probs = torch.gather(probs_chunk, 2, chunk_targets.unsqueeze(-1))
                extracted = target_probs.flatten().detach().cpu().float().tolist()
                real_probs.extend(extracted)

            del logits
            del outputs

    del past_key_values

    t1 = time.perf_counter()
    inference_ms = round((t1 - t0) * 1000, 2)

    vram_mb = 0
    if device.type == "cuda":
        vram_mb = round(torch.cuda.memory_allocated(device) / (1024 * 1024), 1)

    tokens_result = []
    min_len = min(len(offsets), len(real_probs))

    for idx in range(min_len):
        start, end = offsets[idx]
        if start >= end:
            continue
        raw_tok = text[start:end]
        prob = max(float(real_probs[idx]), ZERO_CONFIDENCE_PROBABILITY_BASELINE)
        if not math.isfinite(prob) or prob <= 0:
            prob = ZERO_CONFIDENCE_PROBABILITY_BASELINE

        surprisal = -math.log2(prob)
        ci = min(1.0, max(0.0, surprisal / MAX_SURPRISAL_BITS))
        level = min(15, max(0, int(ci * 16)))

        tokens_result.append({
            "offset": [start, end],
            "raw": raw_tok,
            "prob": round(prob, 7),
            "surprisalBits": round(surprisal, 3),
            "ciRatio": round(ci, 4),
            "level": level,
        })

    return {
        "tokens": tokens_result,
        "inputTokens": seq_len,
        "inferenceTimeMs": inference_ms,
        "modelName": "Qwen3-0.6B-Base",
        "device": str(device),
        "vramAllocatedMB": vram_mb,
    }


def daemon_loop():
    """Persistent JSON-RPC daemon loop over stdin/stdout"""
    try:
        model, tokenizer, device = load_model()
        vram = 0
        if _device.type == "cuda":
            import torch
            vram = round(torch.cuda.memory_allocated(_device) / (1024 * 1024), 1)
        ready_payload = {
            "status": "ready",
            "device": str(_device),
            "model": "Qwen3-0.6B-Base",
            "vramAllocatedMB": vram
        }
        print(json.dumps(ready_payload, ensure_ascii=False), flush=True)
    except Exception as e:
        err_payload = {"status": "error", "error": f"Model load failed: {str(e)}"}
        print(json.dumps(err_payload, ensure_ascii=False), flush=True)
        sys.exit(1)

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
            req_id = req.get("id")
            action = req.get("action", "analyze")

            if action == "ping":
                resp = {"id": req_id, "status": "ok", "action": "pong"}
                print(json.dumps(resp, ensure_ascii=False), flush=True)
                continue

            if action == "analyze":
                text = req.get("text", "")
                result = analyze_text(text)
                resp = {
                    "id": req_id,
                    "status": "ok",
                    **result
                }
                print(json.dumps(resp, ensure_ascii=False), flush=True)
                continue

            resp = {"id": req_id, "status": "error", "error": f"Unknown action: {action}"}
            print(json.dumps(resp, ensure_ascii=False), flush=True)
        except Exception as err:
            resp = {"id": req.get("id") if 'req' in locals() else None, "status": "error", "error": str(err)}
            print(json.dumps(resp, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description="Qwen Highlight Inference Runner")
    parser.add_argument("--daemon", action="store_true", help="Run as persistent JSON-RPC daemon")
    parser.add_argument("--text", type=str, help="Single-shot test sentence")
    parser.add_argument("--model-path", type=str, help="Custom local model weights path")
    args = parser.parse_args()

    if args.daemon:
        daemon_loop()
    elif args.text:
        res = analyze_text(args.text)
        print(json.dumps(res, ensure_ascii=False, indent=2))
    else:
        # Default test
        test_sent = "量子计算利用量子叠加与纠缠特性，展现出超越经典计算机的指数级加速潜力。"
        print(f"Testing sentence: {test_sent}\n")
        res = analyze_text(test_sent)
        print(f"Inference time: {res['inferenceTimeMs']}ms | Tokens: {res['inputTokens']} | Device: {res['device']}")
        print(f"{'Token':<10} | {'Prob':<10} | {'Surprisal':<10} | {'CI':<8} | {'Lvl':<4}")
        print("-" * 55)
        for tok in res["tokens"]:
            print(f"{tok['raw']:<10} | {tok['prob']:<10.3e} | {tok['surprisalBits']:<10.2f} | {tok['ciRatio']:<8.1%} | {tok['level']:<4}")


if __name__ == "__main__":
    main()
