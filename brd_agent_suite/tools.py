"""generate_all_documents: the tool the conversational root_agent calls once it has enough
context (either the user answered clarifying questions, or explicitly asked for best-guess
assumptions). Runs the internal extraction -> parallel-generation -> consistency-check pipeline
via its own Runner + InMemorySessionService, writes the five documents to disk, and returns a
summary dict for the root agent to relay conversationally.

run_pipeline_and_write() is the shared engine behind this, also used directly (not as an LLM-facing
tool) by webapp/server.py for the structured-form and revision flows, which seed session state
differently (a partial form / an existing requirements object) instead of a free-text message.
"""

import json
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from google.adk.agents import BaseAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types

from .config import APP_NAME, OUTPUT_DIR_NAME
from .pipeline import document_pipeline

PROJECT_ROOT = Path(__file__).resolve().parent
OUTPUT_ROOT = PROJECT_ROOT / OUTPUT_DIR_NAME

OUTPUT_FILES = {
    "requirements_json": ("requirements.json", "json"),
    "brd_markdown": ("BRD.md", "text"),
    "tsd_markdown": ("TSD.md", "text"),
    "flowchart_mermaid": ("flowchart.mmd", "text"),
    "architecture_mermaid": ("architecture.mmd", "text"),
    "onepager_markdown": ("Executive_OnePager.md", "text"),
    "consistency_report": ("consistency_report.md", "text"),
}


def new_run_id() -> str:
    return f"{datetime.now(timezone.utc):%Y%m%d-%H%M%S}-{uuid.uuid4().hex[:6]}"


def _iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def write_run_meta(
    run_dir: Path,
    started_at: str,
    finished_at: str,
    duration_seconds: float,
    parent_run_id: Optional[str] = None,
) -> None:
    """run_meta.json: wall-clock time for the whole pipeline run (session creation through the
    last document being written) — the dashboard's "generation time" KPI reads this. Separate from
    observability.py's per-LLM-call logs (logs/<run_id>.jsonl), which only cover model latency, not
    the non-LLM work (session setup, writing files) around it.

    parent_run_id is the run this one was a "request a change" revision of, if any — the only place
    that relationship is persisted (webapp/service.py.revise_run passes it through), since a
    revision's own session/state carries no memory of where it came from. This is what lets the
    History view group a run and its revisions together instead of listing every revision as an
    unrelated top-level run."""
    run_dir.mkdir(parents=True, exist_ok=True)
    meta = {
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_seconds": duration_seconds,
        "parent_run_id": parent_run_id,
    }
    (run_dir / "run_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def write_state_outputs(run_dir: Path, state: dict) -> tuple[dict[str, str], list[str]]:
    """Writes whichever of OUTPUT_FILES are present in state to run_dir. Returns (written, missing)."""
    run_dir.mkdir(parents=True, exist_ok=True)
    written_files: dict[str, str] = {}
    missing: list[str] = []
    for state_key, (filename, kind) in OUTPUT_FILES.items():
        value = state.get(state_key)
        if value is None:
            missing.append(state_key)
            continue
        file_path = run_dir / filename
        if kind == "json":
            file_path.write_text(json.dumps(value, indent=2), encoding="utf-8")
        else:
            file_path.write_text(str(value), encoding="utf-8")
        written_files[state_key] = str(file_path)
    return written_files, missing


async def run_pipeline_and_write(
    pipeline_agent: BaseAgent,
    run_id: str,
    *,
    message_text: Optional[str] = None,
    initial_state: Optional[dict[str, Any]] = None,
    parent_run_id: Optional[str] = None,
) -> dict:
    """Runs pipeline_agent to completion in its own session and writes its outputs to OUTPUT_ROOT/run_id.

    Args:
        pipeline_agent: A SequentialAgent built by pipeline.build_document_pipeline (or the chat
            flow's document_pipeline singleton).
        run_id: Directory name under OUTPUT_ROOT to write results to.
        message_text: If given, sent as the initial user turn's content (what extraction_agent and
            revision_agent read as their task/prose input).
        initial_state: If given, seeded directly into the session's state before running (what
            gap_filler_agent and revision_agent read their {partial_requirements_json} /
            {requirements_json} template variables from).
        parent_run_id: If this run is a "request a change" revision of an earlier run, that run's
            id — persisted to run_meta.json so the run history can be shown as a hierarchy.

    Returns:
        A dict with run_id, output_dir, files (state key -> written path), missing (state keys with
        no value produced), duration_seconds, parent_run_id, and the consistency_report text.
    """
    run_dir = OUTPUT_ROOT / run_id
    started_at = _iso_now()
    started_monotonic = time.monotonic()

    session_service = InMemorySessionService()
    user_id = "brd_agent_user"
    session = await session_service.create_session(
        app_name=APP_NAME, user_id=user_id, session_id=run_id, state=initial_state
    )

    runner = Runner(agent=pipeline_agent, app_name=APP_NAME, session_service=session_service)

    new_message = types.Content(role="user", parts=[types.Part(text=message_text or "Proceed.")])

    async for _event in runner.run_async(user_id=user_id, session_id=session.id, new_message=new_message):
        pass  # The pipeline's agents write everything to session state via output_key.

    final_session = await session_service.get_session(app_name=APP_NAME, user_id=user_id, session_id=run_id)
    state = final_session.state

    written_files, missing = write_state_outputs(run_dir, state)

    finished_at = _iso_now()
    duration_seconds = round(time.monotonic() - started_monotonic, 2)
    write_run_meta(run_dir, started_at, finished_at, duration_seconds, parent_run_id)

    return {
        "run_id": run_id,
        "output_dir": str(run_dir),
        "files": written_files,
        "missing": missing,
        "duration_seconds": duration_seconds,
        "parent_run_id": parent_run_id,
        "requirements_json": state.get("requirements_json"),
        "documents": {
            "brd_markdown": state.get("brd_markdown"),
            "tsd_markdown": state.get("tsd_markdown"),
            "flowchart_mermaid": state.get("flowchart_mermaid"),
            "architecture_mermaid": state.get("architecture_mermaid"),
            "onepager_markdown": state.get("onepager_markdown"),
        },
        "consistency_report": state.get("consistency_report", "(consistency check did not run)"),
    }


async def generate_all_documents(context: str) -> dict:
    """Runs the full BRD/TSD/diagram/one-pager generation pipeline and writes the results to disk.

    Args:
        context: The fully-resolved project description to generate documents from — the
            original request plus any clarifying-question answers the user gave, or an explicit
            note that the user asked for best-guess assumptions on any unanswered gaps.

    Returns:
        A dict with the run_id, the output directory, a map of document name -> file path, and
        the consistency-check report text, so the calling agent can summarize the run and surface
        any flagged contradictions to the user.
    """
    run_id = new_run_id()
    result = await run_pipeline_and_write(document_pipeline, run_id, message_text=context)
    # Keep this tool's return shape exactly as before (no requirements_json/documents blobs —
    # the chat agent only needs file paths and the consistency report to relay conversationally).
    return {
        "run_id": result["run_id"],
        "output_dir": result["output_dir"],
        "files": result["files"],
        "missing": result["missing"],
        "consistency_report": result["consistency_report"],
    }
