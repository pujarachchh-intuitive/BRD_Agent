"""Data-access layer for the `documents` table, plus the Unity Catalog Volume upload that backs
each row's file_path.

Versioning: version is sequential per (project_id, document_type) — the Nth time a project
produces a document of a given type (its original generation, or any later revision), that
document gets version N. So the table holds full history per type, not just the current one;
the highest version for a (project_id, document_type) pair is the current document.

DOCUMENT_TYPES_BY_FILENAME is the single mapping from a run folder's filename to a document_type
— shared by the live generation pipeline (webapp/service.py, dual-writing as each file is
produced) and the one-time backfill script (webapp/scripts/migrate_artifacts.py, walking
existing run folders). A filename with no entry here is left alone (e.g. transient
`.export_*.md` files, which are deleted before a request completes anyway).
"""

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from webapp.db import download_from_volume, execute, fetch_all, fetch_one, qualified, upload_to_volume
from webapp.db import volume_path as _volume_path

DOCUMENTS_TABLE = qualified("documents")

DOCUMENT_TYPES_BY_FILENAME: dict[str, str] = {
    "requirements.json": "REQUIREMENTS_JSON",
    "BRD.md": "BRD",
    "TSD.md": "TSD",
    "Executive_OnePager.md": "ONEPAGER",
    "consistency_report.md": "CONSISTENCY_REPORT",
    "flowchart.mmd": "FLOWCHART_DIAGRAM",
    "architecture.mmd": "ARCHITECTURE_DIAGRAM",
    "flowchart.png": "FLOWCHART_DIAGRAM_IMAGE",
    "architecture.png": "ARCHITECTURE_DIAGRAM_IMAGE",
    "BRD.docx": "BRD_DOCX",
    "TSD.docx": "TSD_DOCX",
    "Executive_OnePager.docx": "ONEPAGER_DOCX",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def get_latest_version(project_id: str, document_type: str) -> int:
    """0 if this project has no document of this type yet."""
    row = fetch_one(
        f"""SELECT MAX(version) AS max_version FROM {DOCUMENTS_TABLE}
        WHERE project_id = :project_id AND document_type = :document_type""",
        {"project_id": project_id, "document_type": document_type},
    )
    return (row or {}).get("max_version") or 0


def create_document(
    *,
    project_id: str,
    document_type: str,
    version: int,
    file_path: str,
    file_name: str,
    run_id: Optional[str] = None,
    status: str = "ACTIVE",
) -> dict:
    document_id = str(uuid.uuid4())
    now = _now_iso()
    execute(
        f"""INSERT INTO {DOCUMENTS_TABLE}
        (document_id, project_id, document_type, version, file_path, file_name, run_id, status, created_at, updated_at)
        VALUES (:document_id, :project_id, :document_type, :version, :file_path, :file_name, :run_id, :status, :created_at, :updated_at)""",
        {
            "document_id": document_id,
            "project_id": project_id,
            "document_type": document_type,
            "version": version,
            "file_path": file_path,
            "file_name": file_name,
            "run_id": run_id,
            "status": status,
            "created_at": now,
            "updated_at": now,
        },
    )
    return {
        "document_id": document_id,
        "project_id": project_id,
        "document_type": document_type,
        "version": version,
        "file_path": file_path,
        "file_name": file_name,
        "run_id": run_id,
        "status": status,
        "created_at": now,
        "updated_at": now,
    }


def list_documents_for_project(project_id: str) -> list[dict]:
    return fetch_all(
        f"SELECT * FROM {DOCUMENTS_TABLE} WHERE project_id = :project_id ORDER BY document_type, version",
        {"project_id": project_id},
    )


def get_documents_for_run(run_id: str) -> list[dict]:
    """Every document row tagged with this run_id — what webapp/service.py's load_run() reads
    to display a specific run's content (as opposed to a project's current/latest documents)."""
    return fetch_all(f"SELECT * FROM {DOCUMENTS_TABLE} WHERE run_id = :run_id", {"run_id": run_id})


def download_document_content(document: dict) -> bytes:
    """Fetches a document row's actual file content from the Volume."""
    return download_from_volume(document["file_path"])


def backfill_run_id(document_id: str, run_id: str) -> None:
    """One-time reconciliation only — see webapp/scripts/backfill_document_run_ids.py. Every
    document created from here on gets run_id set directly by create_document instead."""
    execute(
        f"UPDATE {DOCUMENTS_TABLE} SET run_id = :run_id, updated_at = :now WHERE document_id = :document_id",
        {"run_id": run_id, "now": _now_iso(), "document_id": document_id},
    )


def upload_document_version(*, project_id: str, document_type: str, local_path: Path, run_id: str) -> dict:
    """Uploads local_path to the Volume as the next version of (project_id, document_type) and
    records it in the documents table, tagged with the run_id that produced it.

    Not safe to call twice for what is really "the same" artifact — each call always allocates a
    new version. Callers must only call this once per genuinely new file (a run just produced,
    a diagram just uploaded, a docx just exported) — see webapp/service.py's call sites and
    webapp/scripts/migrate_artifacts.py's per-run-id idempotency check.

    Concurrency note: get_latest_version + create_document is not atomic. Two requests writing
    the same (project_id, document_type) at the same instant could compute the same "next"
    version. Acceptable for this app's current traffic (a project's documents are written by
    one user at a time); revisit with a MERGE-based allocation if that stops being true.
    """
    version = get_latest_version(project_id, document_type) + 1
    destination = _volume_path(project_id, document_type, f"v{version}", local_path.name)
    upload_to_volume(local_path, destination)
    return create_document(
        project_id=project_id,
        document_type=document_type,
        version=version,
        file_path=destination,
        file_name=local_path.name,
        run_id=run_id,
    )
