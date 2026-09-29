"""Tests for webapp/documents_repository.py's versioning, webapp/service.py's dual-write
(_sync_run_documents) and load_run (the Databricks-backed read path).

fake_documents (tests/conftest.py) fakes get_latest_version/create_document/
get_documents_for_run/upload_to_volume/download_from_volume, not upload_document_version or
load_run itself, so these tests exercise the real version-increment, lookup, and content-assembly
logic.
"""

from pathlib import Path

from webapp import documents_repository, service
from webapp.auth.schemas import UserPublic

ADMIN = UserPublic(user_id="admin-1", name="Admin", email="admin@example.com", role="ADMIN", status="ACTIVE")


def _write(tmp_path: Path, name: str, content: str = "content") -> Path:
    path = tmp_path / name
    path.write_text(content, encoding="utf-8")
    return path


def test_upload_document_version_starts_at_one(tmp_path, fake_documents):
    local_path = _write(tmp_path, "BRD.md")
    doc = documents_repository.upload_document_version(
        project_id="proj-1", document_type="BRD", local_path=local_path, run_id="run-1"
    )
    assert doc["version"] == 1
    assert doc["file_name"] == "BRD.md"
    assert doc["run_id"] == "run-1"
    assert fake_documents.uploads == [(str(local_path), doc["file_path"])]


def test_upload_document_version_increments_per_project_and_type(tmp_path, fake_documents):
    local_path = _write(tmp_path, "BRD.md")
    first = documents_repository.upload_document_version(project_id="proj-1", document_type="BRD", local_path=local_path, run_id="run-1")
    second = documents_repository.upload_document_version(project_id="proj-1", document_type="BRD", local_path=local_path, run_id="run-2")
    assert first["version"] == 1
    assert second["version"] == 2

    # A different project, or a different document_type on the same project, starts its own count.
    other_project = documents_repository.upload_document_version(project_id="proj-2", document_type="BRD", local_path=local_path, run_id="run-3")
    other_type = documents_repository.upload_document_version(project_id="proj-1", document_type="TSD", local_path=local_path, run_id="run-1")
    assert other_project["version"] == 1
    assert other_type["version"] == 1


def test_sync_run_documents_uploads_only_recognized_files(tmp_path, fake_documents):
    written_files = {
        "requirements_json": str(_write(tmp_path, "requirements.json", "{}")),
        "brd_markdown": str(_write(tmp_path, "BRD.md")),
        "tsd_markdown": str(_write(tmp_path, "TSD.md")),
        "flowchart_mermaid": str(_write(tmp_path, "flowchart.mmd")),
        "architecture_mermaid": str(_write(tmp_path, "architecture.mmd")),
        "onepager_markdown": str(_write(tmp_path, "Executive_OnePager.md")),
        "consistency_report": str(_write(tmp_path, "consistency_report.md")),
    }
    service._sync_run_documents("proj-3", "run-3", written_files)

    document_types = {d["document_type"] for d in fake_documents.documents}
    assert document_types == {
        "REQUIREMENTS_JSON",
        "BRD",
        "TSD",
        "FLOWCHART_DIAGRAM",
        "ARCHITECTURE_DIAGRAM",
        "ONEPAGER",
        "CONSISTENCY_REPORT",
    }
    assert all(d["project_id"] == "proj-3" and d["version"] == 1 and d["run_id"] == "run-3" for d in fake_documents.documents)


def test_sync_run_documents_ignores_unrecognized_filenames(tmp_path, fake_documents):
    written_files = {"scratch": str(_write(tmp_path, "not_a_real_artifact.txt"))}
    service._sync_run_documents("proj-4", "run-4", written_files)
    assert fake_documents.documents == []


def test_second_generation_for_same_project_bumps_version(tmp_path, fake_documents):
    first_run = {"brd_markdown": str(_write(tmp_path, "BRD.md", "v1"))}
    second_run = {"brd_markdown": str(_write(tmp_path, "BRD.md", "v2"))}

    service._sync_run_documents("proj-5", "run-5a", first_run)
    service._sync_run_documents("proj-5", "run-5b", second_run)

    brd_versions = sorted(d["version"] for d in fake_documents.documents if d["document_type"] == "BRD")
    assert brd_versions == [1, 2]

    # Each version is tagged with the run that actually produced it, not just the project.
    by_run_id = {d["run_id"]: d["version"] for d in fake_documents.documents if d["document_type"] == "BRD"}
    assert by_run_id == {"run-5a": 1, "run-5b": 2}


def test_load_run_reads_content_from_databricks(tmp_path, fake_documents, fake_runs):
    written_files = {
        "requirements_json": str(_write(tmp_path, "requirements.json", '{"project_name": "Test"}')),
        "brd_markdown": str(_write(tmp_path, "BRD.md", "# BRD content")),
        "tsd_markdown": str(_write(tmp_path, "TSD.md", "# TSD content")),
        "consistency_report": str(_write(tmp_path, "consistency_report.md", "PASS")),
    }
    service._sync_run_documents("proj-6", "run-6", written_files)
    fake_runs.insert_generation_run(run_id="run-6", user_id="admin-1", project_id="proj-6")

    result = service.load_run("run-6", ADMIN)

    assert result["run_id"] == "run-6"
    assert result["requirements_json"] == {"project_name": "Test"}
    assert result["documents"]["brd_markdown"] == "# BRD content"
    assert result["documents"]["tsd_markdown"] == "# TSD content"
    assert result["documents"]["flowchart_mermaid"] is None  # never produced for this run
    assert result["consistency_report"] == "PASS"


def test_load_run_returns_none_when_no_documents_exist(fake_documents, fake_runs):
    fake_runs.insert_generation_run(run_id="run-7", user_id="admin-1", project_id="proj-7")
    assert service.load_run("run-7", ADMIN) is None


def test_load_run_distinguishes_between_two_runs_of_the_same_project(tmp_path, fake_documents, fake_runs):
    """A revision must show its own content, not the project's latest version of everything.

    Both runs write to the *same* local filenames (as real runs in the same OUTPUT_ROOT-adjacent
    folder structure would each have their own directory, but the point being tested is version
    history, not path layout) — so each write+sync pair must happen fully before the next write
    touches the file again, or the upload would read the wrong content.
    """
    _write(tmp_path, "requirements.json", "{}")
    _write(tmp_path, "BRD.md", "original BRD")
    service._sync_run_documents(
        "proj-8",
        "run-8-original",
        {"requirements_json": str(tmp_path / "requirements.json"), "brd_markdown": str(tmp_path / "BRD.md")},
    )

    _write(tmp_path, "BRD.md", "revised BRD")
    service._sync_run_documents(
        "proj-8",
        "run-8-revision",
        {"requirements_json": str(tmp_path / "requirements.json"), "brd_markdown": str(tmp_path / "BRD.md")},
    )

    fake_runs.insert_generation_run(run_id="run-8-original", user_id="admin-1", project_id="proj-8")
    fake_runs.insert_generation_run(run_id="run-8-revision", user_id="admin-1", project_id="proj-8")

    assert service.load_run("run-8-original", ADMIN)["documents"]["brd_markdown"] == "original BRD"
    assert service.load_run("run-8-revision", ADMIN)["documents"]["brd_markdown"] == "revised BRD"
