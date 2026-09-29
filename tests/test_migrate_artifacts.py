"""Tests for webapp/scripts/migrate_artifacts.py against the same in-memory fakes as the rest
of the suite (tests/conftest.py) — no real Databricks or local output/ directory touched.
"""

from pathlib import Path

from webapp.auth.security import hash_password
from webapp.scripts import migrate_artifacts

VALID_PASSWORD = "supersecret123"


def _make_run_dir(tmp_path: Path, run_id: str) -> Path:
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "requirements.json").write_text("{}", encoding="utf-8")
    (run_dir / "BRD.md").write_text("# BRD", encoding="utf-8")
    (run_dir / "TSD.md").write_text("# TSD", encoding="utf-8")
    return run_dir


def _make_admin(fake_store):
    return fake_store.create_user(
        name="Admin", email="admin@example.com", password_hash=hash_password(VALID_PASSWORD), role="ADMIN", status="ACTIVE"
    )


def test_no_admin_aborts_without_writing_anything(tmp_path, monkeypatch, fake_store, fake_projects, fake_runs, fake_documents, fake_audit):
    _make_run_dir(tmp_path, "20260101-000000-aaaaaa")
    monkeypatch.setattr(migrate_artifacts, "OUTPUT_ROOT", tmp_path)

    exit_code = migrate_artifacts.main([])

    assert exit_code == 1
    assert fake_documents.documents == []
    assert fake_runs.runs_by_id == {}


def test_legacy_run_gets_shared_legacy_project(tmp_path, monkeypatch, fake_store, fake_projects, fake_runs, fake_documents, fake_audit):
    admin = _make_admin(fake_store)
    run_id = "20260101-000001-bbbbbb"
    _make_run_dir(tmp_path, run_id)
    monkeypatch.setattr(migrate_artifacts, "OUTPUT_ROOT", tmp_path)

    exit_code = migrate_artifacts.main([])

    assert exit_code == 0
    # A generation_runs row now exists for this previously-unowned run, tagged to a new project
    # owned by the admin — it's no longer "legacy" from webapp/service.py's point of view.
    owner = fake_runs.get_run_owner(run_id)
    assert owner is not None
    assert owner["user_id"] == admin["user_id"]

    legacy_project = fake_projects.get_project_by_id(owner["project_id"])
    assert legacy_project["is_legacy"] is True
    assert legacy_project["user_id"] == admin["user_id"]

    document_types = {d["document_type"] for d in fake_documents.documents}
    assert {"REQUIREMENTS_JSON", "BRD", "TSD"} <= document_types
    assert all(d["project_id"] == owner["project_id"] for d in fake_documents.documents)
    assert all(d["run_id"] == run_id for d in fake_documents.documents)


def test_two_legacy_runs_share_one_legacy_project(tmp_path, monkeypatch, fake_store, fake_projects, fake_runs, fake_documents, fake_audit):
    _make_admin(fake_store)
    _make_run_dir(tmp_path, "20260101-000002-cccccc")
    _make_run_dir(tmp_path, "20260101-000003-dddddd")
    monkeypatch.setattr(migrate_artifacts, "OUTPUT_ROOT", tmp_path)

    migrate_artifacts.main([])

    project_ids = {p["project_id"] for p in fake_projects.projects_by_id.values()}
    assert len(project_ids) == 1


def test_owned_run_uses_its_existing_project(tmp_path, monkeypatch, fake_store, fake_projects, fake_runs, fake_documents, fake_audit):
    admin = _make_admin(fake_store)
    owner_user = fake_store.create_user(
        name="Owner", email="owner@example.com", password_hash=hash_password(VALID_PASSWORD), role="USER", status="ACTIVE"
    )
    project = fake_projects.create_project(user_id=owner_user["user_id"], project_name="Existing Project")
    run_id = "20260101-000004-eeeeee"
    _make_run_dir(tmp_path, run_id)
    fake_runs.insert_generation_run(run_id=run_id, user_id=owner_user["user_id"], project_id=project["project_id"])
    monkeypatch.setattr(migrate_artifacts, "OUTPUT_ROOT", tmp_path)

    migrate_artifacts.main([])

    # No new (legacy) project was created — the run's documents attach to its real project.
    assert len(fake_projects.projects_by_id) == 1
    assert all(d["project_id"] == project["project_id"] for d in fake_documents.documents)
    _ = admin


def test_rerunning_skips_already_migrated_runs(tmp_path, monkeypatch, fake_store, fake_projects, fake_runs, fake_documents, fake_audit):
    _make_admin(fake_store)
    _make_run_dir(tmp_path, "20260101-000005-ffffff")
    monkeypatch.setattr(migrate_artifacts, "OUTPUT_ROOT", tmp_path)

    migrate_artifacts.main([])
    documents_after_first_run = len(fake_documents.documents)
    migrate_artifacts.main([])

    assert len(fake_documents.documents) == documents_after_first_run


def test_dry_run_writes_nothing(tmp_path, monkeypatch, fake_store, fake_projects, fake_runs, fake_documents, fake_audit):
    _make_admin(fake_store)
    _make_run_dir(tmp_path, "20260101-000006-abcabc")
    monkeypatch.setattr(migrate_artifacts, "OUTPUT_ROOT", tmp_path)

    exit_code = migrate_artifacts.main(["--dry-run"])

    assert exit_code == 0
    assert fake_documents.documents == []
    assert fake_runs.runs_by_id == {}
    assert fake_projects.projects_by_id == {}
