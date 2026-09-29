"""One-time backfill: uploads every existing local run's generated artifacts to the Unity
Catalog Volume and records them in the `documents` table.

Run from the project root:

    python -m webapp.scripts.migrate_artifacts [--dry-run]

Idempotent: re-running skips any run_id already migrated (tracked via an ARTIFACT_MIGRATED
audit_logs entry per run_id), so it's safe to run again later after new local runs accumulate.

Legacy runs (no generation_runs ownership row — created before the ownership step, or via
`adk web`/`adk run` directly) are all attached to one shared "Legacy Runs" project, owned by
whichever admin account exists (see _get_or_create_legacy_project). A generation_runs row is
backfilled for each of them too, so they behave like any other owned run from then on instead of
staying permanently ADMIN-only.

This script only reads local files and writes to Databricks — it never deletes or modifies
anything under brd_agent_suite/output/.
"""

import argparse
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parents[2] / ".env")

from brd_agent_suite.tools import OUTPUT_ROOT  # noqa: E402
from webapp import audit, runs_repository  # noqa: E402
from webapp.auth import repository as auth_repository  # noqa: E402
from webapp.documents_repository import DOCUMENT_TYPES_BY_FILENAME, upload_document_version  # noqa: E402
from webapp.projects import repository as projects_repository  # noqa: E402
from webapp.service import aggregate_run_log  # noqa: E402 -- reuse the existing token/provider/model rollup

LEGACY_PROJECT_NAME = "Legacy Runs (pre-ownership)"
MIGRATED_ACTION = "ARTIFACT_MIGRATED"


def _get_or_create_legacy_project(admin_user_id: str) -> dict:
    for project in projects_repository.list_projects_for_user(admin_user_id):
        if project["is_legacy"] and project["project_name"] == LEGACY_PROJECT_NAME:
            return project
    return projects_repository.create_project(
        user_id=admin_user_id, project_name=LEGACY_PROJECT_NAME, is_legacy=True, status="ACTIVE"
    )


def _backfill_generation_run(run_id: str, project_id: str, admin_user_id: str) -> None:
    log_stats = aggregate_run_log(run_id)
    runs_repository.insert_generation_run(
        run_id=run_id,
        user_id=admin_user_id,
        project_id=project_id,
        generation_type="legacy_backfill",
        status="backfilled",
        provider=log_stats["provider"],
        model=log_stats["model"],
        input_tokens=log_stats["input_tokens"],
        output_tokens=log_stats["output_tokens"],
        total_tokens=log_stats["total_tokens"],
    )


def migrate_run(run_id: str, run_dir: Path, project_id: str, admin_user_id: str, dry_run: bool) -> list[str]:
    uploaded = []
    for filename, document_type in DOCUMENT_TYPES_BY_FILENAME.items():
        local_path = run_dir / filename
        if not local_path.exists():
            continue
        if not dry_run:
            upload_document_version(
                project_id=project_id, document_type=document_type, local_path=local_path, run_id=run_id
            )
        uploaded.append(f"{document_type} ({filename})")
    if not dry_run:
        audit.insert_audit_log(
            user_id=admin_user_id,
            action=MIGRATED_ACTION,
            entity_type="run",
            entity_id=run_id,
            metadata={"project_id": project_id, "document_types": uploaded},
        )
    return uploaded


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run", action="store_true", help="Report what would be migrated without writing anything to Databricks."
    )
    args = parser.parse_args(argv)

    if not OUTPUT_ROOT.exists():
        print(f"{OUTPUT_ROOT} does not exist — nothing to migrate.")
        return 0

    admin = auth_repository.get_active_admin()
    if admin is None:
        print("No active admin account found. Run `python -m webapp.scripts.create_admin` first.")
        return 1

    run_dirs = sorted(p for p in OUTPUT_ROOT.iterdir() if p.is_dir() and (p / "requirements.json").exists())
    print(f"Found {len(run_dirs)} local run(s) under {OUTPUT_ROOT}.")

    legacy_project: dict | None = None
    migrated_count = 0
    skipped_count = 0

    for run_dir in run_dirs:
        run_id = run_dir.name
        if audit.has_audit_log(entity_type="run", entity_id=run_id, action=MIGRATED_ACTION):
            skipped_count += 1
            continue

        owner = runs_repository.get_run_owner(run_id)
        if owner is not None:
            project_id = owner["project_id"]
        else:
            if args.dry_run:
                project_id = "<legacy-project, created on a real run>"
            else:
                if legacy_project is None:
                    legacy_project = _get_or_create_legacy_project(admin["user_id"])
                project_id = legacy_project["project_id"]
                _backfill_generation_run(run_id, project_id, admin["user_id"])

        uploaded = migrate_run(run_id, run_dir, project_id, admin["user_id"], args.dry_run)
        migrated_count += 1
        label = "would migrate" if args.dry_run else "migrated"
        print(f"  [{label}] {run_id}: {', '.join(uploaded) if uploaded else '(no recognized files)'}")

    verb = "Dry run" if args.dry_run else "Migration"
    print(f"\n{verb} complete: {migrated_count} run(s) processed, {skipped_count} already migrated.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
