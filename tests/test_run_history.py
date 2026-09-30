"""Tests for GET /api/runs's Databricks-backed listing (service.list_runs) and for fetching a
run's files from the Volume when they aren't on the local disk (service._ensure_local_files) —
the case of a deployed backend serving runs that were generated on a different machine."""

import json
from pathlib import Path

from webapp import service
from webapp.auth.schemas import UserPublic

ADMIN = UserPublic(user_id="admin-1", name="Admin", email="admin@example.com", role="ADMIN", status="ACTIVE")


def _upload_run(src_dir: Path, project_id: str, run_id: str, files: dict[str, str]) -> None:
    """Records `files` (filename -> content) in the fake documents table/Volume for run_id, the
    way a real generation's _sync_run_documents would — without leaving them in OUTPUT_ROOT."""
    src_dir.mkdir(parents=True, exist_ok=True)
    written = {}
    for name, content in files.items():
        path = src_dir / name
        path.write_text(content, encoding="utf-8")
        written[name] = str(path)
    service._sync_run_documents(project_id, run_id, written)


def test_list_runs_reads_from_databricks_without_local_run_folders(tmp_path, tmp_output_root, fake_documents, fake_runs, fake_projects):
    project = fake_projects.create_project(user_id="admin-1", project_name="Payments Portal")
    _upload_run(tmp_path / "_src1", project["project_id"], "20260901-100000-aaaaaa", {
        "requirements.json": json.dumps({"project_name": "Payments Portal"}),
        "consistency_report.md": "PASS — no contradictions",
    })
    fake_runs.insert_generation_run(
        run_id="20260901-100000-aaaaaa", user_id="admin-1", project_id=project["project_id"],
        model="gemini-3.7-flash", input_tokens=1_000_000, output_tokens=0, total_tokens=1_000_000,
        latency_ms=42_000, metadata={"parent_run_id": None},
    )

    [run] = service.list_runs(ADMIN)

    assert run["run_id"] == "20260901-100000-aaaaaa"
    assert run["project_name"] == "Payments Portal"
    assert run["duration_seconds"] == 42.0
    assert run["total_tokens"] == 1_000_000
    assert run["estimated_cost_usd"] == 0.75  # 1M input tokens at the configured rate
    assert run["consistency_status"] == "pass"  # fetched from the Volume — nothing was on disk


def test_list_runs_takes_legacy_project_names_from_requirements(tmp_path, tmp_output_root, fake_documents, fake_runs, fake_projects):
    legacy = fake_projects.create_project(user_id="admin-1", project_name="Legacy Runs (pre-ownership)", is_legacy=True)
    _upload_run(tmp_path / "_src", legacy["project_id"], "20260801-090000-bbbbbb", {
        "requirements.json": json.dumps({"project_name": "Old Inventory Tool"}),
        "consistency_report.md": "Contradictions found",
    })
    fake_runs.insert_generation_run(run_id="20260801-090000-bbbbbb", user_id="admin-1", project_id=legacy["project_id"])

    [run] = service.list_runs(ADMIN)

    assert run["project_name"] == "Old Inventory Tool"
    assert run["consistency_status"] == "issues"
    assert run["duration_seconds"] is None  # never captured for legacy runs — must stay null, not 0


def test_list_runs_uses_stored_metadata_without_downloading(tmp_path, tmp_output_root, fake_documents, fake_runs, fake_projects):
    project = fake_projects.create_project(user_id="admin-1", project_name="CRM")
    _upload_run(tmp_path / "_src", project["project_id"], "20260902-100000-cccccc", {"requirements.json": "{}"})
    fake_runs.insert_generation_run(
        run_id="20260902-100000-cccccc", user_id="admin-1", project_id=project["project_id"],
        metadata={"parent_run_id": "20260901-000000-parent", "cost_by_agent": {"brd_agent": 0.01}, "consistency_status": "pass"},
    )
    downloads_before = len(fake_documents.volume_contents)

    [run] = service.list_runs(ADMIN)

    assert run["consistency_status"] == "pass"
    assert run["cost_by_agent"] == {"brd_agent": 0.01}
    assert run["parent_run_id"] == "20260901-000000-parent"
    assert not (tmp_output_root / "20260902-100000-cccccc").exists()  # nothing needed fetching
    assert len(fake_documents.volume_contents) == downloads_before


def test_list_runs_scopes_users_and_skips_runs_without_documents(tmp_path, tmp_output_root, fake_documents, fake_runs, fake_projects):
    mine = fake_projects.create_project(user_id="user-1", project_name="Mine")
    theirs = fake_projects.create_project(user_id="user-2", project_name="Theirs")
    _upload_run(tmp_path / "_a", mine["project_id"], "20260903-100000-mine00", {"requirements.json": "{}"})
    _upload_run(tmp_path / "_b", theirs["project_id"], "20260903-100000-theirs", {"requirements.json": "{}"})
    fake_runs.insert_generation_run(run_id="20260903-100000-mine00", user_id="user-1", project_id=mine["project_id"])
    fake_runs.insert_generation_run(run_id="20260903-100000-theirs", user_id="user-2", project_id=theirs["project_id"])
    # Recorded but its documents never made it to Databricks — load_run can't open it, so it isn't listed.
    fake_runs.insert_generation_run(run_id="20260903-100000-nodocs", user_id="user-1", project_id=mine["project_id"])

    user = UserPublic(user_id="user-1", name="U", email="u@example.com", role="USER", status="ACTIVE")
    assert [r["run_id"] for r in service.list_runs(user)] == ["20260903-100000-mine00"]
    assert {r["run_id"] for r in service.list_runs(ADMIN)} == {"20260903-100000-mine00", "20260903-100000-theirs"}


def test_ensure_local_files_downloads_only_missing_files(tmp_path, tmp_output_root, fake_documents):
    _upload_run(tmp_path / "_src", "proj-1", "run-x", {"BRD.md": "# from databricks", "TSD.md": "# tsd"})
    run_dir = tmp_output_root / "run-x"
    run_dir.mkdir()
    (run_dir / "TSD.md").write_text("# already here", encoding="utf-8")

    service._ensure_local_files("run-x", ["BRD.md", "TSD.md", "flowchart.png"])

    assert (run_dir / "BRD.md").read_text(encoding="utf-8") == "# from databricks"
    assert (run_dir / "TSD.md").read_text(encoding="utf-8") == "# already here"  # never overwritten
    assert not (run_dir / "flowchart.png").exists()  # Databricks doesn't have it either
    assert not list(run_dir.glob("*.part"))
