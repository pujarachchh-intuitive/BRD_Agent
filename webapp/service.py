"""Business logic for the structured-form webapp: normalizing form submissions into a partial
RequirementsModel, running the form/revision pipelines, and exporting documents to DOCX.

Kept separate from server.py so the FastAPI route handlers stay thin.
"""

import base64
import json
import re
import shutil
import subprocess
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException, status

from brd_agent_suite.config import MODEL_NAME, PROVIDER_NAME
from brd_agent_suite.observability import LOGS_ROOT, _estimate_cost_usd
from brd_agent_suite.pipeline import build_document_pipeline
from brd_agent_suite.sub_agents.gap_filler_agent import build_gap_filler_agent
from brd_agent_suite.sub_agents.revision_agent import build_revision_agent
from brd_agent_suite.tools import OUTPUT_ROOT, new_run_id, run_pipeline_and_write
from webapp import audit, documents_repository, runs_repository
from webapp.auth.schemas import UserPublic
from webapp.projects import service as projects_service

# (field name, kind) — kind is "scalar" | "list_str" | "list_obj".
# Mirrors schema.RequirementsModel exactly, minus `assumptions` (system-managed, never a form input).
FORM_FIELDS: list[tuple[str, str]] = [
    ("project_name", "scalar"),
    ("doc_id_acronym", "scalar"),
    ("problem_statement", "scalar"),
    ("business_context", "scalar"),
    ("objectives", "list_obj"),
    ("stakeholders", "list_obj"),
    ("target_users", "list_obj"),
    ("scope_in", "list_str"),
    ("scope_deferred", "list_obj"),
    ("scope_permanently_excluded", "list_str"),
    ("functional_requirements", "list_obj"),
    ("non_functional_requirements", "list_obj"),
    ("constraints", "list_str"),
    ("risks", "list_obj"),
    ("success_metrics", "list_str"),
    ("dependencies", "list_str"),
    ("tech_stack_preferences", "list_str"),
    ("system_components", "list_obj"),
    ("data_flow_steps", "list_str"),
    ("integrations", "list_str"),
    ("timeline_phases", "list_obj"),
    ("open_questions", "list_str"),
    ("decision_audience", "scalar"),
    ("additional_sections", "list_obj"),
]

# Fields with no exclude option at all in the UI — derived from the reference BRDs/TSDs, where every
# structural section (objectives, scope-in, requirements, NFRs, risks, architecture, tech stack, data
# flow, timeline) was substantively populated in every real example; none appeared blank or omitted.
# This is the backend-side backstop for that — never allowed in excluded_sections regardless of what
# a raw API request claims. A subset of these (CRITICAL_FIELDS) additionally have no auto-generate
# option in the UI, since they're foundational identity fields no context could invent from scratch.
CRITICAL_FIELDS = {"project_name", "problem_statement", "target_users", "stakeholders"}
NEVER_EXCLUDABLE_FIELDS = CRITICAL_FIELDS | {
    "doc_id_acronym",
    "business_context",
    "objectives",
    "scope_in",
    "scope_deferred",
    "functional_requirements",
    "non_functional_requirements",
    "risks",
    "tech_stack_preferences",
    "system_components",
    "data_flow_steps",
    "timeline_phases",
}

# Fields whose list items get a server-assigned sequential ID (the user never types one).
_ID_PREFIXES = {
    "objectives": "OBJ",
    "functional_requirements": "BR",
    "risks": "R",
}


def _assign_ids(items: list[dict], prefix: str) -> list[dict]:
    out = []
    for i, item in enumerate(items, start=1):
        item = dict(item)
        item["id"] = f"{prefix}-{i:02d}"
        out.append(item)
    return out


def normalize_form(form: dict[str, Any], excluded_sections: Optional[list[str]] = None) -> dict[str, Any]:
    """Builds the partial_requirements_json seed. Every field is copied through verbatim — auto_fields
    (passed separately to the pipeline as its own state var) is purely a signal to gap_filler_agent
    about which fields to complete, not an instruction to clear anything here. A field marked auto with
    no content means "generate this from scratch"; a field marked auto with content already in it
    means "use this as a seed and enrich/expand it." Sequential IDs are assigned to
    objectives/functional_requirements/risks either way.

    excluded_sections are field names the user said don't apply to this project — forced empty here
    regardless of whatever the form happened to submit for them, and never allowed on a field the
    reference documents show as always populated (NEVER_EXCLUDABLE_FIELDS).
    """
    excluded = set(excluded_sections or []) - NEVER_EXCLUDABLE_FIELDS
    result: dict[str, Any] = {"assumptions": [], "excluded_sections": sorted(excluded)}
    for field, kind in FORM_FIELDS:
        if field in excluded:
            result[field] = "" if kind == "scalar" else []
            continue
        value = form.get(field)
        if kind == "scalar":
            result[field] = value or ""
        elif kind == "list_str":
            result[field] = value or []
        else:  # list_obj
            items = value or []
            if field in _ID_PREFIXES:
                items = _assign_ids(items, _ID_PREFIXES[field])
            result[field] = items
    return result


def _authorize_run_access(run_id: str, current_user: UserPublic) -> None:
    """Every endpoint keyed by run_id (view/revise/upload-diagram/export) calls this before
    touching anything. ADMIN always passes. A USER passes only if this run_id was recorded
    (by _record_generation_run, below) against a project they own.

    A run_id with no generation_runs row is a "legacy" run — created before ownership tracking
    existed, or via `adk web`/`adk run` directly. Per the no-migration-yet requirement, those are
    intentionally left unowned: only ADMIN can reach them until a later migration step.
    """
    if current_user.role == "ADMIN":
        return
    owner = runs_repository.get_run_owner(run_id)
    if owner is None:
        audit.insert_audit_log(user_id=current_user.user_id, action="ACCESS_DENIED", entity_type="run", entity_id=run_id)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This run predates ownership tracking and is only accessible to an admin",
        )
    # Re-checked against the live projects table (not just the user_id captured on the
    # generation_runs row) so ownership always flows from the same single source of truth as
    # every other project-scoped check.
    projects_service.get_owned_project_or_404(owner["project_id"], current_user)


def _record_generation_run(result: dict, current_user: UserPublic, project: dict, generation_type: str) -> None:
    log_stats = aggregate_run_log(result["run_id"])
    latency_ms = int(result["duration_seconds"] * 1000) if result.get("duration_seconds") is not None else None
    runs_repository.insert_generation_run(
        run_id=result["run_id"],
        user_id=current_user.user_id,
        project_id=project["project_id"],
        generation_type=generation_type,
        status="success" if not result.get("missing") else "partial",
        # provider/model fall back to the static config constants only in the edge case of a run
        # whose log is missing/empty (e.g. zero LLM calls) — every normal run's log already has
        # both on every record, so this is a safety net, not the primary source.
        provider=log_stats["provider"] or PROVIDER_NAME,
        model=log_stats["model"] or MODEL_NAME,
        input_tokens=log_stats["input_tokens"],
        output_tokens=log_stats["output_tokens"],
        total_tokens=log_stats["total_tokens"],
        latency_ms=latency_ms,
        # cost_by_agent and consistency_status are stored here so GET /api/runs can report them
        # from Databricks alone — the per-call logs and the report file they come from otherwise
        # live only on the disk of whichever machine generated the run.
        metadata={
            "parent_run_id": result.get("parent_run_id"),
            "cost_by_agent": log_stats["cost_by_agent"],
            "consistency_status": _consistency_status_from_text(result.get("consistency_report")),
        },
    )
    action = "BRD_GENERATED" if generation_type == "generate" else "BRD_UPDATED"
    audit.insert_audit_log(
        user_id=current_user.user_id,
        action=action,
        entity_type="project",
        entity_id=project["project_id"],
        metadata={"run_id": result["run_id"]},
    )
    _sync_run_documents(project["project_id"], result["run_id"], result.get("files") or {})


def _sync_run_documents(project_id: str, run_id: str, written_files: dict[str, str]) -> None:
    """Uploads every artifact this run just wrote locally (tools.write_state_outputs' return
    value) to the Volume and records it as a new document version, tagged with run_id — the
    dual-write half of generation. Only files matching DOCUMENT_TYPES_BY_FILENAME are uploaded;
    anything else is left as filesystem-only (there's currently nothing else in that dict, but
    this stays correct if that ever changes)."""
    for path_str in written_files.values():
        local_path = Path(path_str)
        document_type = documents_repository.DOCUMENT_TYPES_BY_FILENAME.get(local_path.name)
        if document_type is None:
            continue
        documents_repository.upload_document_version(
            project_id=project_id, document_type=document_type, local_path=local_path, run_id=run_id
        )


async def generate_from_form(
    form: dict[str, Any],
    auto_fields: list[str],
    excluded_sections: Optional[list[str]] = None,
    *,
    current_user: UserPublic,
    project_id: Optional[str] = None,
) -> dict:
    if project_id:
        # Ownership of the (client-supplied) project_id is always re-verified server-side against
        # who actually owns it in Databricks — never trusted just because the request named it.
        project = projects_service.get_owned_project_or_404(project_id, current_user)
    else:
        project_name = (form.get("project_name") or "").strip() or "Untitled Project"
        project = projects_service.create_project_row(current_user, project_name)

    partial = normalize_form(form, excluded_sections)
    auto_fields = [f for f in auto_fields if f not in partial["excluded_sections"]]
    run_id = new_run_id()
    pipeline = build_document_pipeline(build_gap_filler_agent(), name="form_pipeline")
    result = await run_pipeline_and_write(
        pipeline,
        run_id,
        message_text="Complete the form as instructed.",
        initial_state={"partial_requirements_json": partial, "auto_fields": auto_fields},
    )
    _record_generation_run(result, current_user, project, generation_type="generate")
    result["project_id"] = project["project_id"]
    return result


async def revise_run(run_id: str, change_request: str, *, current_user: UserPublic) -> dict:
    _authorize_run_access(run_id, current_user)
    owner = runs_repository.get_run_owner(run_id)  # None only possible here for an ADMIN caller
    project = projects_service.get_owned_project_or_404(owner["project_id"], current_user) if owner else None

    existing_path = _ensure_local_files(run_id, ["requirements.json"]) / "requirements.json"
    if not existing_path.exists():
        raise FileNotFoundError(f"No requirements.json found for run {run_id}")
    existing = json.loads(existing_path.read_text(encoding="utf-8"))

    new_id = new_run_id()
    pipeline = build_document_pipeline(build_revision_agent(), name="revision_pipeline")
    result = await run_pipeline_and_write(
        pipeline,
        new_id,
        message_text=change_request,
        initial_state={"requirements_json": existing},
        parent_run_id=run_id,
    )
    if project is not None:
        _record_generation_run(result, current_user, project, generation_type="revision")
        result["project_id"] = project["project_id"]
    return result


def _consistency_status_from_text(report: Optional[str]) -> Optional[str]:
    """"pass" | "issues" | None (no report). Same PASS/no-contradictions heuristic the frontend's
    ConsistencyPanel applies to a single run's report — mirrored here so the dashboard can
    aggregate a pass rate across every run without re-fetching each one's full report."""
    if not report:
        return None
    head = report[:400]
    if re.search(r"\bPASS\b", head, re.IGNORECASE) or re.search(r"no contradictions", head, re.IGNORECASE):
        return "pass"
    return "issues"


def _read_consistency_status(run_dir: Path) -> Optional[str]:
    report_path = run_dir / "consistency_report.md"
    if not report_path.exists():
        return None
    try:
        return _consistency_status_from_text(report_path.read_text(encoding="utf-8"))
    except OSError:
        return None


def _read_run_meta(run_dir: Path) -> dict:
    """run_meta.json, written by tools.write_run_meta() — absent for runs generated before that
    instrumentation existed, so callers must treat every field as optional."""
    meta_path = run_dir / "run_meta.json"
    if not meta_path.exists():
        return {}
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


_EMPTY_RUN_LOG_STATS = {
    "total_tokens": None,
    "input_tokens": None,
    "output_tokens": None,
    "provider": None,
    "model": None,
    "estimated_cost_usd": None,
    "llm_calls": 0,
    "cost_by_agent": {},
}


def aggregate_run_log(run_id: str) -> dict:
    """Best-effort token/cost rollup from logs/<run_id>.jsonl (observability.py's per-LLM-call
    records across every agent in the run's pipeline). Absent for runs generated before that
    logging was wired in, so every field here is nullable — never treat a missing log as zero.

    provider/model are read from the log rather than assumed from config, so this stays correct
    even if a future sub-agent calls a different model — every record in a run's log uses the
    same provider/model today, so the first non-null value found is used.

    cost_by_agent breaks the cost total down per agent_id (e.g. "brd_agent", "tsd_agent") — the
    dashboard sums this across every run to chart where generation cost actually goes."""
    log_path = LOGS_ROOT / f"{run_id}.jsonl"
    if not log_path.exists():
        return dict(_EMPTY_RUN_LOG_STATS)
    total_tokens = 0
    total_input_tokens = 0
    total_output_tokens = 0
    total_cost = 0.0
    calls = 0
    has_tokens = False
    has_input_tokens = False
    has_output_tokens = False
    has_cost = False
    provider: Optional[str] = None
    model: Optional[str] = None
    cost_by_agent: dict[str, float] = {}
    try:
        for line in log_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            calls += 1
            if record.get("total_tokens") is not None:
                total_tokens += record["total_tokens"]
                has_tokens = True
            if record.get("input_tokens") is not None:
                total_input_tokens += record["input_tokens"]
                has_input_tokens = True
            if record.get("output_tokens") is not None:
                total_output_tokens += record["output_tokens"]
                has_output_tokens = True
            provider = provider or record.get("provider")
            model = model or record.get("model")
            cost = record.get("estimated_cost_usd")
            if cost is not None:
                total_cost += cost
                has_cost = True
                agent = record.get("agent_id") or "unknown"
                cost_by_agent[agent] = round(cost_by_agent.get(agent, 0.0) + cost, 6)
    except (json.JSONDecodeError, OSError):
        return dict(_EMPTY_RUN_LOG_STATS)
    return {
        "total_tokens": total_tokens if has_tokens else None,
        "input_tokens": total_input_tokens if has_input_tokens else None,
        "output_tokens": total_output_tokens if has_output_tokens else None,
        "provider": provider,
        "model": model,
        "estimated_cost_usd": round(total_cost, 6) if has_cost else None,
        "llm_calls": calls,
        "cost_by_agent": cost_by_agent,
    }


def _latest_by_file_name(documents: list[dict]) -> dict[str, dict]:
    """file_name -> that file's highest-version document row (a run re-exporting a docx, say,
    records a new version under the same run_id)."""
    latest: dict[str, dict] = {}
    for doc in documents:
        current = latest.get(doc["file_name"])
        if current is None or doc["version"] > current["version"]:
            latest[doc["file_name"]] = doc
    return latest


def _ensure_local_files(run_id: str, filenames: list[str], documents: Optional[list[dict]] = None) -> Path:
    """Returns the run's working folder under OUTPUT_ROOT, first downloading from the Databricks
    Volume any of `filenames` that aren't already there (skipping any Databricks doesn't have
    either). Databricks is the source of truth for every run; OUTPUT_ROOT is only the working
    folder the pipeline and pandoc read and write files in — so a run generated on a different
    machine (a laptop vs. the deployed backend) still works everywhere, with nothing to copy by
    hand. `documents` can pass the run's already-fetched document rows to save a query."""
    run_dir = OUTPUT_ROOT / run_id
    missing = [name for name in filenames if not (run_dir / name).exists()]
    if not missing:
        return run_dir
    if documents is None:
        documents = documents_repository.get_documents_for_run(run_id)
    by_name = _latest_by_file_name(documents)
    for name in missing:
        doc = by_name.get(name)
        if doc is None:
            continue
        content = documents_repository.download_document_content(doc)
        run_dir.mkdir(parents=True, exist_ok=True)
        # Written under a temporary name and then renamed, so a concurrent reader never sees a
        # half-written file.
        partial = run_dir / f".{name}.{uuid.uuid4().hex}.part"
        partial.write_bytes(content)
        partial.replace(run_dir / name)
    return run_dir


def _parse_run_metadata(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw) if raw else {}
    except (TypeError, json.JSONDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _run_summary(row: dict, documents: list[dict]) -> dict:
    """One GET /api/runs entry, built from the run's generation_runs row. Only what that row
    can't supply is read from files, fetched from the Volume if needed: the consistency report
    (for runs recorded before consistency_status was stored in metadata) and requirements.json
    (for legacy runs, whose project is the shared "Legacy Runs" one, so the real project name is
    only in the requirements). Local run_meta.json and logs/<run_id>.jsonl are used as fallbacks
    only — runs recorded before duration/cost were captured have no value anywhere, so the
    dashboard must still treat those fields as optional per run."""
    run_id = row["run_id"]
    meta = _parse_run_metadata(row.get("metadata"))
    project_name = None if row.get("is_legacy") else row.get("project_name")
    consistency_status = meta.get("consistency_status")

    needed = []
    if consistency_status is None:
        needed.append("consistency_report.md")
    if not project_name:
        needed.append("requirements.json")
    run_dir = OUTPUT_ROOT / run_id
    if needed:
        try:
            run_dir = _ensure_local_files(run_id, needed, documents)
        except Exception as exc:  # noqa: BLE001 — one unreachable file must not hide the whole run list
            print(f"Could not fetch {needed} for run {run_id} from Databricks: {exc}")

    if consistency_status is None:
        consistency_status = _read_consistency_status(run_dir)
    if not project_name:
        try:
            project_name = json.loads((run_dir / "requirements.json").read_text(encoding="utf-8")).get("project_name")
        except (OSError, json.JSONDecodeError):
            project_name = row.get("project_name")

    local_meta = _read_run_meta(run_dir)
    log_stats = aggregate_run_log(run_id)
    latency_ms = row.get("latency_ms")
    cost = _estimate_cost_usd(row.get("model"), row.get("input_tokens"), row.get("output_tokens"))["estimated_cost_usd"]
    return {
        "run_id": run_id,
        "project_name": project_name or None,
        "duration_seconds": latency_ms / 1000 if latency_ms is not None else local_meta.get("duration_seconds"),
        "total_tokens": row.get("total_tokens") if row.get("total_tokens") is not None else log_stats["total_tokens"],
        "estimated_cost_usd": cost if cost is not None else log_stats["estimated_cost_usd"],
        "cost_by_agent": meta.get("cost_by_agent") or log_stats["cost_by_agent"],
        "consistency_status": consistency_status,
        # Only present for revisions made through this webapp's "request a change" flow — a run
        # with no parent is either an original request or an older, unlinkable revision.
        "parent_run_id": meta.get("parent_run_id") or local_meta.get("parent_run_id"),
    }


def list_runs(current_user: UserPublic) -> list[dict]:
    """Every run recorded in Databricks (generation_runs) that has documents to show — newest
    first (run_id is a sortable UTC timestamp prefix). ADMIN sees every run; a USER sees only
    runs recorded against them. Read from Databricks, not the local disk, so the list is the same
    no matter which machine (a laptop, the deployed backend) serves it or generated the run.

    Runs with no REQUIREMENTS_JSON document are left out, matching load_run, which can't open
    them either (e.g. a run whose document upload never completed)."""
    rows = runs_repository.list_runs(None if current_user.role == "ADMIN" else current_user.user_id)
    documents_by_run: dict[str, list[dict]] = {}
    for doc in documents_repository.list_run_documents_of_types(["REQUIREMENTS_JSON", "CONSISTENCY_REPORT"]):
        documents_by_run.setdefault(doc["run_id"], []).append(doc)
    rows = [
        row for row in rows
        if any(d["document_type"] == "REQUIREMENTS_JSON" for d in documents_by_run.get(row["run_id"], []))
    ]
    # Parallel, since a run whose files aren't on this machine yet costs a Volume download or two.
    # Workers match the db connection pool size.
    with ThreadPoolExecutor(max_workers=4) as pool:
        runs = list(pool.map(lambda row: _run_summary(row, documents_by_run[row["run_id"]]), rows))
    runs.sort(key=lambda r: r["run_id"], reverse=True)
    return runs


# document_type -> the RunResult.documents key the frontend expects (see frontend/src/lib/types.ts).
_DOCUMENT_TYPE_TO_RESULT_KEY = {
    "BRD": "brd_markdown",
    "TSD": "tsd_markdown",
    "FLOWCHART_DIAGRAM": "flowchart_mermaid",
    "ARCHITECTURE_DIAGRAM": "architecture_mermaid",
    "ONEPAGER": "onepager_markdown",
}


def load_run(run_id: str, current_user: UserPublic) -> Optional[dict]:
    """Reads this run's documents from Databricks (the `documents` table + brd_artifacts Volume)
    rather than the local filesystem — the Volume is the source of truth for viewing a run, same
    as it now is for storage; the local files under OUTPUT_ROOT remain the pipeline's own
    working directory, not something the API reads back from anymore.

    Returns None (-> 404) if this run has no documents in Databricks, exactly like the old
    "file doesn't exist locally" check — most commonly a legacy run predating both ownership
    tracking and this migration, or one lost before it could be synced (see the REQUIREMENTS_JSON
    check below: every run this app itself ever completed successfully has one)."""
    _authorize_run_access(run_id, current_user)
    documents = documents_repository.get_documents_for_run(run_id)
    by_type = {doc["document_type"]: doc for doc in documents}
    requirements_doc = by_type.get("REQUIREMENTS_JSON")
    if requirements_doc is None:
        return None

    def _download(doc: dict) -> str:
        # The uploaded bytes preserve whatever line endings the pipeline originally wrote to disk
        # (CRLF on Windows) — read_text()'s universal-newlines mode silently normalized that to
        # "\n" under the old local-filesystem read path, so normalize the same way here to keep
        # the API response byte-for-byte the same shape as before.
        raw = documents_repository.download_document_content(doc).decode("utf-8")
        return raw.replace("\r\n", "\n")

    # Each download is its own Volume round trip (~0.5s+), and a run has up to 7 of them — fetched
    # concurrently rather than one after another. Workers match the db connection pool size.
    wanted = ["REQUIREMENTS_JSON", "CONSISTENCY_REPORT", *_DOCUMENT_TYPE_TO_RESULT_KEY]
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {t: pool.submit(_download, by_type[t]) for t in wanted if t in by_type}
        contents = {t: f.result() for t, f in futures.items()}

    return {
        "run_id": run_id,
        "requirements_json": json.loads(contents["REQUIREMENTS_JSON"]),
        "documents": {key: contents.get(doc_type) for doc_type, key in _DOCUMENT_TYPE_TO_RESULT_KEY.items()},
        "consistency_report": contents.get("CONSISTENCY_REPORT"),
    }


def _project_id_for_run(run_id: str) -> Optional[str]:
    """None for a legacy run (no generation_runs row) — nothing to dual-write to in that case,
    since documents.project_id is required and legacy runs have no project of their own yet."""
    owner = runs_repository.get_run_owner(run_id)
    return owner["project_id"] if owner else None


def _sync_document(run_id: str, local_path: Path) -> None:
    """Uploads a single just-produced artifact (a diagram PNG, a docx export) to the Volume as
    a new document version, if it's a recognized type and the run has a project to attach it
    to. Mirrors _sync_run_documents but for the one-file-at-a-time call sites below."""
    document_type = documents_repository.DOCUMENT_TYPES_BY_FILENAME.get(local_path.name)
    if document_type is None:
        return
    project_id = _project_id_for_run(run_id)
    if project_id is None:
        return
    documents_repository.upload_document_version(
        project_id=project_id, document_type=document_type, local_path=local_path, run_id=run_id
    )


def save_diagram_png(run_id: str, name: str, data_url: str, current_user: UserPublic) -> Path:
    """name is 'architecture' or 'flowchart'. data_url is a data:image/png;base64,... string."""
    _authorize_run_access(run_id, current_user)
    run_dir = OUTPUT_ROOT / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    match = re.match(r"^data:image/png;base64,(.+)$", data_url, re.DOTALL)
    raw = base64.b64decode(match.group(1) if match else data_url)
    out_path = run_dir / f"{name}.png"
    out_path.write_bytes(raw)
    _sync_document(run_id, out_path)
    return out_path


def _find_pandoc() -> str:
    found = shutil.which("pandoc")
    if found:
        return found
    fallback = Path.home() / "AppData" / "Local" / "Pandoc" / "pandoc.exe"
    if fallback.exists():
        return str(fallback)
    raise RuntimeError("pandoc not found on PATH or at the default install location")


_DOC_FILENAMES = {
    "brd": "BRD.md",
    "tsd": "TSD.md",
    "onepager": "Executive_OnePager.md",
}


def export_docx(run_id: str, doc: str, current_user: UserPublic) -> Path:
    _authorize_run_access(run_id, current_user)
    if doc not in _DOC_FILENAMES:
        raise ValueError(f"Unknown document '{doc}', expected one of {list(_DOC_FILENAMES)}")
    run_dir = _ensure_local_files(run_id, [_DOC_FILENAMES[doc], "architecture.png", "flowchart.png"])
    md_path = run_dir / _DOC_FILENAMES[doc]
    if not md_path.exists():
        raise FileNotFoundError(f"{md_path} does not exist")

    text = md_path.read_text(encoding="utf-8")
    # Strip references to diagrams that were never rendered/uploaded, so export degrades
    # gracefully instead of pandoc hard-failing on a missing image file.
    for image_name in ("architecture.png", "flowchart.png"):
        if not (run_dir / image_name).exists():
            text = re.sub(rf"!\[[^\]]*\]\({re.escape(image_name)}\)\n?", "", text)

    export_md_path = run_dir / f".export_{doc}.md"
    export_md_path.write_text(text, encoding="utf-8")

    out_path = run_dir / f"{_DOC_FILENAMES[doc].rsplit('.', 1)[0]}.docx"
    pandoc = _find_pandoc()
    subprocess.run(
        [pandoc, export_md_path.name, "-o", out_path.name],
        cwd=str(run_dir),
        check=True,
        capture_output=True,
    )
    export_md_path.unlink(missing_ok=True)
    _sync_document(run_id, out_path)
    audit.insert_audit_log(
        user_id=current_user.user_id, action="BRD_DOWNLOADED", entity_type="run", entity_id=run_id, metadata={"doc": doc}
    )
    return out_path
