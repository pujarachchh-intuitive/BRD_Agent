"""One-time reconciliation: sets `documents.run_id` for rows created by migrate_artifacts.py
before that column existed.

Run from the project root, once, after `ALTER TABLE ... documents ADD COLUMN run_id STRING`:

    python -m webapp.scripts.backfill_document_run_ids

Safe to run again: only touches rows where run_id IS NULL, so a repeat run is a no-op. Only
reads local files and updates the run_id column on existing rows — never deletes or modifies
anything under brd_agent_suite/output/, and never touches file_path/version/any other column.

How the mapping is reconstructed: upload_document_version originally assigned each document's
version by counting, per (project_id, document_type), how many versions of that type already
existed. This script recreates that exact same count, in the exact same order (run folders
sorted by name, i.e. chronologically — run_id's timestamp prefix guarantees that), and claims the
existing row at each resulting (project_id, document_type, version) for that run_id. Since the
local files are untouched, the "does this run's folder have file X" checks are byte-for-byte the
same ones migrate_artifacts.py made when it originally allocated those versions, so the
reconstruction is exact — this isn't a heuristic guess re-derived from unrelated data.
"""

import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parents[2] / ".env")

from brd_agent_suite.tools import OUTPUT_ROOT  # noqa: E402
from webapp import documents_repository, runs_repository  # noqa: E402
from webapp.documents_repository import DOCUMENT_TYPES_BY_FILENAME  # noqa: E402


def main() -> int:
    if not OUTPUT_ROOT.exists():
        print(f"{OUTPUT_ROOT} does not exist — nothing to backfill.")
        return 0

    run_dirs = sorted(p for p in OUTPUT_ROOT.iterdir() if p.is_dir() and (p / "requirements.json").exists())

    # Group run_ids by the project they belong to, preserving the chronological (sorted) order.
    run_ids_by_project: dict[str, list[str]] = {}
    for run_dir in run_dirs:
        owner = runs_repository.get_run_owner(run_dir.name)
        if owner is not None:
            run_ids_by_project.setdefault(owner["project_id"], []).append(run_dir.name)

    updated = 0
    already_done = 0
    for project_id, run_ids in run_ids_by_project.items():
        # (document_type, version) -> document_id, restricted to rows not yet backfilled.
        unclaimed = {
            (doc["document_type"], doc["version"]): doc["document_id"]
            for doc in documents_repository.list_documents_for_project(project_id)
            if doc.get("run_id") is None
        }
        next_version: dict[str, int] = {}
        for run_id in run_ids:
            run_dir = OUTPUT_ROOT / run_id
            for filename, document_type in DOCUMENT_TYPES_BY_FILENAME.items():
                if not (run_dir / filename).exists():
                    continue
                version = next_version.get(document_type, 0) + 1
                next_version[document_type] = version
                document_id = unclaimed.pop((document_type, version), None)
                if document_id is None:
                    already_done += 1
                    continue
                documents_repository.backfill_run_id(document_id, run_id)
                updated += 1
                print(f"  {run_id}: {document_type} v{version} -> run_id set")

    print(f"\nBackfill complete: {updated} document row(s) updated, {already_done} already had a run_id.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
