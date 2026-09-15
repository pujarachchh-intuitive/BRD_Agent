"""Business logic for the structured-form webapp: normalizing form submissions into a partial
RequirementsModel, running the form/revision pipelines, and exporting documents to DOCX.

Kept separate from server.py so the FastAPI route handlers stay thin.
"""

import base64
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from brd_agent_suite.pipeline import build_document_pipeline
from brd_agent_suite.sub_agents.gap_filler_agent import build_gap_filler_agent
from brd_agent_suite.sub_agents.revision_agent import build_revision_agent
from brd_agent_suite.tools import OUTPUT_ROOT, new_run_id, run_pipeline_and_write

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


async def generate_from_form(form: dict[str, Any], auto_fields: list[str], excluded_sections: Optional[list[str]] = None) -> dict:
    partial = normalize_form(form, excluded_sections)
    auto_fields = [f for f in auto_fields if f not in partial["excluded_sections"]]
    run_id = new_run_id()
    pipeline = build_document_pipeline(build_gap_filler_agent(), name="form_pipeline")
    return await run_pipeline_and_write(
        pipeline,
        run_id,
        message_text="Complete the form as instructed.",
        initial_state={"partial_requirements_json": partial, "auto_fields": auto_fields},
    )


async def revise_run(run_id: str, change_request: str) -> dict:
    existing_path = OUTPUT_ROOT / run_id / "requirements.json"
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
    )
    result["parent_run_id"] = run_id
    return result


def list_runs() -> list[dict]:
    """Every run that has ever been written to OUTPUT_ROOT — regardless of whether it came from
    this webapp's form or from `adk web`/`adk run` directly, since both write to the same directory
    via run_pipeline_and_write. Newest first (run_id is a sortable UTC timestamp prefix)."""
    if not OUTPUT_ROOT.exists():
        return []
    runs = []
    for run_dir in OUTPUT_ROOT.iterdir():
        req_path = run_dir / "requirements.json"
        if not run_dir.is_dir() or not req_path.exists():
            continue
        project_name = None
        try:
            project_name = json.loads(req_path.read_text(encoding="utf-8")).get("project_name") or None
        except (json.JSONDecodeError, OSError):
            pass
        runs.append({"run_id": run_dir.name, "project_name": project_name})
    runs.sort(key=lambda r: r["run_id"], reverse=True)
    return runs


def load_run(run_id: str) -> Optional[dict]:
    run_dir = OUTPUT_ROOT / run_id
    req_path = run_dir / "requirements.json"
    if not req_path.exists():
        return None
    doc_files = {
        "brd_markdown": "BRD.md",
        "tsd_markdown": "TSD.md",
        "flowchart_mermaid": "flowchart.mmd",
        "architecture_mermaid": "architecture.mmd",
        "onepager_markdown": "Executive_OnePager.md",
    }
    documents = {}
    for key, filename in doc_files.items():
        path = run_dir / filename
        documents[key] = path.read_text(encoding="utf-8") if path.exists() else None
    report_path = run_dir / "consistency_report.md"
    return {
        "run_id": run_id,
        "requirements_json": json.loads(req_path.read_text(encoding="utf-8")),
        "documents": documents,
        "consistency_report": report_path.read_text(encoding="utf-8") if report_path.exists() else None,
    }


def save_diagram_png(run_id: str, name: str, data_url: str) -> Path:
    """name is 'architecture' or 'flowchart'. data_url is a data:image/png;base64,... string."""
    run_dir = OUTPUT_ROOT / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    match = re.match(r"^data:image/png;base64,(.+)$", data_url, re.DOTALL)
    raw = base64.b64decode(match.group(1) if match else data_url)
    out_path = run_dir / f"{name}.png"
    out_path.write_bytes(raw)
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


def export_docx(run_id: str, doc: str) -> Path:
    if doc not in _DOC_FILENAMES:
        raise ValueError(f"Unknown document '{doc}', expected one of {list(_DOC_FILENAMES)}")
    run_dir = OUTPUT_ROOT / run_id
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
    return out_path
