"""Data-access layer for the `generation_runs` table.

This is also how the app resolves who owns a filesystem run_id: webapp/service.py inserts one
row per pipeline run (generate or revise) here, tagged with the authenticated user_id and the
project_id it was authorized against. A run_id with no row here was created before this
instrumentation existed (or via `adk web`/`adk run` directly, bypassing the webapp) — see
get_run_owner's docstring for how callers must treat that "legacy" case.
"""

import json
import os
import uuid
from datetime import datetime, timezone
from typing import Optional

from webapp.db import execute, fetch_all, fetch_one, qualified

GENERATION_RUNS_TABLE = qualified("generation_runs")
PROJECTS_TABLE = qualified("projects")


def insert_generation_run(
    *,
    run_id: str,
    user_id: str,
    project_id: str,
    generation_type: str,
    status: str,
    agent_id: str = "pipeline",
    provider: Optional[str] = None,
    model: Optional[str] = None,
    input_tokens: Optional[int] = None,
    output_tokens: Optional[int] = None,
    total_tokens: Optional[int] = None,
    latency_ms: Optional[int] = None,
    error_type: Optional[str] = None,
    error_message: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    execute(
        f"""INSERT INTO {GENERATION_RUNS_TABLE}
        (run_id, request_id, timestamp, user_id, project_id, agent_id, provider, model,
         generation_type, input_tokens, output_tokens, total_tokens, latency_ms, status,
         error_type, error_message, endpoint, environment, metadata)
        VALUES (:run_id, :request_id, :timestamp, :user_id, :project_id, :agent_id, :provider, :model,
         :generation_type, :input_tokens, :output_tokens, :total_tokens, :latency_ms, :status,
         :error_type, :error_message, :endpoint, :environment, :metadata)""",
        {
            "run_id": run_id,
            "request_id": f"req_{uuid.uuid4().hex[:12]}",
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "user_id": user_id,
            "project_id": project_id,
            "agent_id": agent_id,
            "provider": provider,
            "model": model,
            "generation_type": generation_type,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": total_tokens,
            "latency_ms": latency_ms,
            "status": status,
            "error_type": error_type,
            "error_message": error_message,
            "endpoint": "/api/generate" if generation_type == "generate" else "/api/runs/{run_id}/revise",
            "environment": os.getenv("APP_ENV", "development"),
            "metadata": json.dumps(metadata) if metadata is not None else None,
        },
    )


def get_run_owner(run_id: str) -> Optional[dict]:
    """Returns {"user_id", "project_id"} for a run this app recorded, or None for a run_id with
    no generation_runs row — i.e. a legacy run predating ownership tracking. Callers must treat
    None as "unowned", not "doesn't exist": never grant a normal USER access on that basis, and
    never invent an owner for it."""
    return fetch_one(
        f"SELECT user_id, project_id FROM {GENERATION_RUNS_TABLE} WHERE run_id = :run_id LIMIT 1",
        {"run_id": run_id},
    )


def list_runs(user_id: Optional[str] = None) -> list[dict]:
    """One row per run_id (its most recent generation_runs row), joined to its project's name and
    is_legacy flag — every run when user_id is None (ADMIN), otherwise only that user's own. This
    is what GET /api/runs lists, so run history comes from Databricks rather than from whatever
    run folders happen to exist on the local disk of the machine serving the request."""
    where = "WHERE r.user_id = :user_id" if user_id else ""
    return fetch_all(
        f"""SELECT r.run_id, r.user_id, r.project_id, r.generation_type, r.model, r.input_tokens,
                   r.output_tokens, r.total_tokens, r.latency_ms, r.metadata,
                   p.project_name, p.is_legacy
            FROM {GENERATION_RUNS_TABLE} r
            LEFT JOIN {PROJECTS_TABLE} p ON p.project_id = r.project_id
            {where}
            QUALIFY ROW_NUMBER() OVER (PARTITION BY r.run_id ORDER BY r.timestamp DESC) = 1""",
        {"user_id": user_id} if user_id else {},
    )


def list_run_ids_for_user(user_id: str) -> set[str]:
    rows = fetch_all(
        f"SELECT DISTINCT run_id FROM {GENERATION_RUNS_TABLE} WHERE user_id = :user_id", {"user_id": user_id}
    )
    return {row["run_id"] for row in rows}
