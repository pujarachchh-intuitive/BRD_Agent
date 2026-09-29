"""Tests for webapp/scripts/backfill_document_run_ids.py — the one-time reconciliation that sets
documents.run_id for rows created before that column existed.

Simulates the "pre-column" state directly (documents rows with run_id=None, created in the same
order/versions migrate_artifacts.py would have used) rather than going through the real
migration, since upload_document_version now always sets run_id for anything created today.
"""

from pathlib import Path

from webapp.scripts import backfill_document_run_ids


def _make_run_dir(tmp_path: Path, run_id: str, *, with_tsd: bool = True) -> Path:
    run_dir = tmp_path / run_id
    run_dir.mkdir()
    (run_dir / "requirements.json").write_text("{}", encoding="utf-8")
    (run_dir / "BRD.md").write_text("# BRD", encoding="utf-8")
    if with_tsd:
        (run_dir / "TSD.md").write_text("# TSD", encoding="utf-8")
    return run_dir


def test_backfill_assigns_run_id_in_chronological_order(tmp_path, monkeypatch, fake_documents, fake_runs):
    project_id = "proj-legacy"
    run_a, run_b = "20260101-000000-aaaaaa", "20260101-000001-bbbbbb"
    _make_run_dir(tmp_path, run_a)
    _make_run_dir(tmp_path, run_b)
    monkeypatch.setattr(backfill_document_run_ids, "OUTPUT_ROOT", tmp_path)

    fake_runs.insert_generation_run(run_id=run_a, user_id="admin-1", project_id=project_id)
    fake_runs.insert_generation_run(run_id=run_b, user_id="admin-1", project_id=project_id)

    # Pre-column-era rows: run_id=None, versions assigned in the same order migrate_run would have.
    doc_a_brd = fake_documents.create_document(project_id=project_id, document_type="BRD", version=1, file_path="p1", file_name="BRD.md")
    doc_b_brd = fake_documents.create_document(project_id=project_id, document_type="BRD", version=2, file_path="p2", file_name="BRD.md")
    doc_a_req = fake_documents.create_document(project_id=project_id, document_type="REQUIREMENTS_JSON", version=1, file_path="p3", file_name="requirements.json")
    doc_b_req = fake_documents.create_document(project_id=project_id, document_type="REQUIREMENTS_JSON", version=2, file_path="p4", file_name="requirements.json")

    exit_code = backfill_document_run_ids.main()

    assert exit_code == 0
    by_id = {d["document_id"]: d for d in fake_documents.documents}
    assert by_id[doc_a_brd["document_id"]]["run_id"] == run_a
    assert by_id[doc_b_brd["document_id"]]["run_id"] == run_b
    assert by_id[doc_a_req["document_id"]]["run_id"] == run_a
    assert by_id[doc_b_req["document_id"]]["run_id"] == run_b


def test_backfill_handles_run_missing_a_document_type(tmp_path, monkeypatch, fake_documents, fake_runs):
    """run_a has no TSD.md; run_b does. TSD version 1 must map to run_b, not run_a."""
    project_id = "proj-legacy2"
    run_a, run_b = "20260101-000002-cccccc", "20260101-000003-dddddd"
    _make_run_dir(tmp_path, run_a, with_tsd=False)
    _make_run_dir(tmp_path, run_b, with_tsd=True)
    monkeypatch.setattr(backfill_document_run_ids, "OUTPUT_ROOT", tmp_path)

    fake_runs.insert_generation_run(run_id=run_a, user_id="admin-1", project_id=project_id)
    fake_runs.insert_generation_run(run_id=run_b, user_id="admin-1", project_id=project_id)

    doc_tsd_v1 = fake_documents.create_document(project_id=project_id, document_type="TSD", version=1, file_path="p1", file_name="TSD.md")

    backfill_document_run_ids.main()

    by_id = {d["document_id"]: d for d in fake_documents.documents}
    assert by_id[doc_tsd_v1["document_id"]]["run_id"] == run_b


def test_backfill_is_idempotent(tmp_path, monkeypatch, fake_documents, fake_runs):
    project_id = "proj-legacy3"
    run_id = "20260101-000004-eeeeee"
    _make_run_dir(tmp_path, run_id)
    monkeypatch.setattr(backfill_document_run_ids, "OUTPUT_ROOT", tmp_path)
    fake_runs.insert_generation_run(run_id=run_id, user_id="admin-1", project_id=project_id)
    fake_documents.create_document(project_id=project_id, document_type="BRD", version=1, file_path="p1", file_name="BRD.md")

    backfill_document_run_ids.main()
    first_pass_run_ids = [d["run_id"] for d in fake_documents.documents]
    backfill_document_run_ids.main()

    assert [d["run_id"] for d in fake_documents.documents] == first_pass_run_ids
    assert len(fake_documents.documents) == 1  # nothing duplicated
