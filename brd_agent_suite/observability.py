"""Per-LLM-call logging.

Hooks into every LlmAgent via ADK's before_model_callback / after_model_callback /
on_model_error_callback (attached in agent.py and each sub_agents/*.py). Each callback pair
brackets exactly one model call, so this is the accurate way to measure latency and pull
token usage — far more reliable than timing the events yielded by Runner.run_async, which
interleave across parallel agents.

One JSON-lines file per run is written to LOGS_ROOT, named after the session id. Every
run_pipeline_and_write() call in tools.py creates its session with session_id=run_id, so the
log file for a given run is always logs/<run_id>.jsonl — sitting next to output/<run_id>/.
"""

import json
import threading
import time
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from .config import ENVIRONMENT, LOGS_DIR_NAME, MODEL_PRICING_PER_1M_TOKENS, PROVIDER_NAME

PROJECT_ROOT = Path(__file__).resolve().parent
LOGS_ROOT = PROJECT_ROOT / LOGS_DIR_NAME

_write_lock = threading.Lock()

# Stack per (invocation_id, agent_name): handles the normal one-call case and, if an agent
# ever makes more than one model call within a single invocation, pairs each before/after in
# LIFO order instead of clobbering a single slot.
_pending_calls: dict[str, list[dict]] = defaultdict(list)


def _pending_key(invocation_id: str, agent_name: str) -> str:
    return f"{invocation_id}:{agent_name}"


def _estimate_cost_usd(model: Optional[str], input_tokens: Optional[int], output_tokens: Optional[int]) -> dict:
    """Returns {"input_cost_usd", "output_cost_usd", "estimated_cost_usd"}, each None if the
    model isn't in MODEL_PRICING_PER_1M_TOKENS or token counts are unavailable."""
    rates = MODEL_PRICING_PER_1M_TOKENS.get(model or "")
    if not rates or input_tokens is None or output_tokens is None:
        return {"input_cost_usd": None, "output_cost_usd": None, "estimated_cost_usd": None}
    input_cost = round(input_tokens * rates.get("input", 0.0) / 1_000_000, 6)
    output_cost = round(output_tokens * rates.get("output", 0.0) / 1_000_000, 6)
    return {
        "input_cost_usd": input_cost,
        "output_cost_usd": output_cost,
        "estimated_cost_usd": round(input_cost + output_cost, 6),
    }


def _write_record(record: dict) -> None:
    LOGS_ROOT.mkdir(parents=True, exist_ok=True)
    log_path = LOGS_ROOT / f"{record['metadata']['run_id']}.jsonl"
    line = json.dumps(record, ensure_ascii=False)
    with _write_lock:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(line + "\n")


def log_before_model_call(callback_context, llm_request):
    """ADK before_model_callback: records the call's start time and model name."""
    key = _pending_key(callback_context.invocation_id, callback_context.agent_name)
    _pending_calls[key].append({"start": time.monotonic(), "model": llm_request.model})
    return None


def log_after_model_call(callback_context, llm_response):
    """ADK after_model_callback: emits a success (or blocked-response) log record."""
    key = _pending_key(callback_context.invocation_id, callback_context.agent_name)
    pending = _pending_calls[key].pop() if _pending_calls[key] else {"start": time.monotonic(), "model": None}

    usage = getattr(llm_response, "usage_metadata", None)
    input_tokens = getattr(usage, "prompt_token_count", None) if usage else None
    output_tokens = getattr(usage, "candidates_token_count", None) if usage else None
    total_tokens = getattr(usage, "total_token_count", None) if usage else None

    error_code = getattr(llm_response, "error_code", None)
    status = "error" if error_code else "success"

    model = pending["model"] or getattr(llm_response, "model_version", None)

    _write_record({
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "agent_id": callback_context.agent_name,
        "request_id": f"req_{uuid.uuid4().hex[:12]}",
        "provider": PROVIDER_NAME,
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": total_tokens,
        "latency_ms": round((time.monotonic() - pending["start"]) * 1000),
        "status": status,
        "error_type": error_code,
        **_estimate_cost_usd(model, input_tokens, output_tokens),
        "metadata": {
            "endpoint": "generate_content",
            "env": ENVIRONMENT,
            "run_id": callback_context.session.id,
            "invocation_id": callback_context.invocation_id,
        },
    })
    return None


def log_model_error_call(callback_context, llm_request, error: Exception):
    """ADK on_model_error_callback: emits a log record for a call that raised instead of returning."""
    key = _pending_key(callback_context.invocation_id, callback_context.agent_name)
    pending = _pending_calls[key].pop() if _pending_calls[key] else {"start": time.monotonic(), "model": llm_request.model}

    _write_record({
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
        "agent_id": callback_context.agent_name,
        "request_id": f"req_{uuid.uuid4().hex[:12]}",
        "provider": PROVIDER_NAME,
        "model": pending["model"] or llm_request.model,
        "input_tokens": None,
        "output_tokens": None,
        "total_tokens": None,
        "latency_ms": round((time.monotonic() - pending["start"]) * 1000),
        "status": "error",
        "error_type": type(error).__name__,
        "input_cost_usd": None,
        "output_cost_usd": None,
        "estimated_cost_usd": None,
        "metadata": {
            "endpoint": "generate_content",
            "env": ENVIRONMENT,
            "run_id": callback_context.session.id,
            "invocation_id": callback_context.invocation_id,
        },
    })
    return None
