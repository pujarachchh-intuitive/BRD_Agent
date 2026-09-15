"""Retrieval helper for the per-run LLM call logs written by observability.py.

Usage:
    python -m brd_agent_suite.logs_viewer                 # list every run that has logs
    python -m brd_agent_suite.logs_viewer <run_id>         # print per-call records + a summary
    python -m brd_agent_suite.logs_viewer <run_id> --json  # summary only, as JSON
"""

import json
import sys
from pathlib import Path

from .observability import LOGS_ROOT


def list_runs() -> list[str]:
    """Run ids with a log file, most recent first."""
    if not LOGS_ROOT.exists():
        return []
    files = sorted(LOGS_ROOT.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
    return [f.stem for f in files]


def load_run(run_id: str) -> list[dict]:
    """All call records for one run, in the order they were logged."""
    log_path = LOGS_ROOT / f"{run_id}.jsonl"
    if not log_path.exists():
        raise FileNotFoundError(f"No log file for run_id '{run_id}' at {log_path}")
    records = []
    with open(log_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


def summarize(records: list[dict]) -> dict:
    total_input = sum(r["input_tokens"] or 0 for r in records)
    total_output = sum(r["output_tokens"] or 0 for r in records)
    total_tokens = sum(r["total_tokens"] or 0 for r in records)
    total_input_cost = sum(r.get("input_cost_usd") or 0 for r in records)
    total_output_cost = sum(r.get("output_cost_usd") or 0 for r in records)
    total_cost = sum(r["estimated_cost_usd"] or 0 for r in records if r["estimated_cost_usd"] is not None)
    errors = [r for r in records if r["status"] == "error"]

    per_agent: dict[str, dict] = {}
    for r in records:
        agent = per_agent.setdefault(r["agent_id"], {"calls": 0, "input_tokens": 0, "output_tokens": 0, "errors": 0})
        agent["calls"] += 1
        agent["input_tokens"] += r["input_tokens"] or 0
        agent["output_tokens"] += r["output_tokens"] or 0
        if r["status"] == "error":
            agent["errors"] += 1

    return {
        "total_calls": len(records),
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_tokens": total_tokens,
        "total_input_cost_usd": round(total_input_cost, 6),
        "total_output_cost_usd": round(total_output_cost, 6),
        "total_estimated_cost_usd": round(total_cost, 6),
        "error_count": len(errors),
        "per_agent": per_agent,
    }


def _main() -> None:
    args = sys.argv[1:]
    if not args:
        runs = list_runs()
        if not runs:
            print(f"No run logs found under {LOGS_ROOT}")
            return
        print(f"{len(runs)} run(s) with logs (most recent first):")
        for run_id in runs:
            print(f"  {run_id}")
        return

    run_id = args[0]
    as_json = "--json" in args
    records = load_run(run_id)
    summary = summarize(records)

    if as_json:
        print(json.dumps(summary, indent=2))
        return

    print(f"Run: {run_id}  ({len(records)} LLM call(s), log file: {LOGS_ROOT / (run_id + '.jsonl')})\n")
    for r in records:
        print(
            f"  [{r['timestamp']}] {r['agent_id']:<28} model={r['model']:<20} "
            f"in={r['input_tokens']} out={r['output_tokens']} latency_ms={r['latency_ms']} "
            f"status={r['status']}" + (f" error={r['error_type']}" if r["error_type"] else "")
        )

    print("\nSummary:")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    _main()
