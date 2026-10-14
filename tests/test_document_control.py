"""Tests for webapp/document_control.py and its use in webapp/service.py: the Date and Author rows
of a BRD/TSD's document-control table are filled with when the run was generated and by whom."""

from datetime import datetime, timezone

from webapp import document_control, service
from webapp.auth.schemas import UserPublic
from webapp.document_control import fill_document_control, format_document_date, run_created_at

ADMIN = UserPublic(user_id="admin-1", name="Admin", email="admin@example.com", role="ADMIN", status="ACTIVE")

BRD = """# BUSINESS REQUIREMENTS DOCUMENT
## Onboarding Dashboard

| Field | Value |
|---|---|
| Document ID | BRD-EOD-001 |
| Date | [Date] |
| Author | [Author] |
| Status | Draft |

### Top Five Features
| # | Feature | Date |
|---|---|---|
| Date | Not the control table | x |
"""

TSD = """# TECHNICAL SPECIFICATION DOCUMENT

| **Version** | 1.0 |
|---|---|
| **Date** | [Date] |
| **Author** | [Author] |
"""


def test_fills_date_and_author_rows_of_the_first_table_only():
    out = fill_document_control(BRD, date="9 October 2026", author="Puja Rachchh")
    assert "| Date | 9 October 2026 |" in out
    assert "| Author | Puja Rachchh |" in out
    assert "| Date | Not the control table | x |" in out  # a later table is left alone
    assert out.count("[Date]") == 0 and out.count("[Author]") == 0


def test_keeps_bold_field_labels():
    out = fill_document_control(TSD, date="9 October 2026", author="Puja Rachchh")
    assert "| **Date** | 9 October 2026 |" in out
    assert "| **Author** | Puja Rachchh |" in out


def test_filling_is_idempotent_and_unknown_values_are_left_alone():
    once = fill_document_control(BRD, date="9 October 2026", author=None)
    assert "| Author | [Author] |" in once
    assert fill_document_control(once, date="9 October 2026", author=None) == once


def test_author_name_cannot_break_the_table():
    out = fill_document_control(BRD, date=None, author="A | B")
    assert "| Author | A \\| B |" in out


def test_run_created_at_reads_the_run_id_timestamp():
    assert run_created_at("20261009-203000-2533ea") == datetime(2026, 10, 9, 20, 30, tzinfo=timezone.utc)
    assert run_created_at("ext-20261009-144435-c93239") == datetime(2026, 10, 9, 14, 44, 35, tzinfo=timezone.utc)
    assert run_created_at("run-6") is None


def test_date_is_shown_in_the_document_timezone(monkeypatch):
    late_evening_utc = datetime(2026, 10, 9, 20, 30, tzinfo=timezone.utc)  # 02:00 on the 10th in India
    monkeypatch.setattr(document_control, "DOCUMENT_TIMEZONE", "Asia/Kolkata")
    assert format_document_date(late_evening_utc) == "10 October 2026"
    monkeypatch.setattr(document_control, "DOCUMENT_TIMEZONE", "UTC")
    assert format_document_date(late_evening_utc) == "9 October 2026"


def test_generated_documents_get_the_requesting_users_name(tmp_path, monkeypatch):
    monkeypatch.setattr(document_control, "DOCUMENT_TIMEZONE", "UTC")
    brd_path = tmp_path / "BRD.md"
    brd_path.write_text(BRD, encoding="utf-8")
    result = {
        "run_id": "20261009-120000-abcdef",
        "files": {"brd_markdown": str(brd_path)},
        "documents": {"brd_markdown": BRD, "onepager_markdown": "# One-pager"},
    }

    service._apply_document_control(result, "Puja Rachchh")

    for text in (brd_path.read_text(encoding="utf-8"), result["documents"]["brd_markdown"]):
        assert "| Date | 9 October 2026 |" in text
        assert "| Author | Puja Rachchh |" in text
    assert result["documents"]["onepager_markdown"] == "# One-pager"


def test_opening_an_older_run_fills_in_its_creator(tmp_path, monkeypatch, fake_documents, fake_runs, fake_store):
    monkeypatch.setattr(document_control, "DOCUMENT_TIMEZONE", "UTC")
    creator = fake_store.create_user(name="Puja Rachchh", email="puja@example.com", password_hash="x", role="USER", status="ACTIVE")
    run_id = "20261009-120000-abcdef"
    files = {"requirements_json": tmp_path / "requirements.json", "brd_markdown": tmp_path / "BRD.md", "tsd_markdown": tmp_path / "TSD.md"}
    files["requirements_json"].write_text("{}", encoding="utf-8")
    files["brd_markdown"].write_text(BRD, encoding="utf-8")
    files["tsd_markdown"].write_text(TSD, encoding="utf-8")
    service._sync_run_documents("proj-1", run_id, {k: str(v) for k, v in files.items()})
    fake_runs.insert_generation_run(run_id=run_id, user_id=creator["user_id"], project_id="proj-1")

    documents = service.load_run(run_id, ADMIN)["documents"]

    assert "| Author | Puja Rachchh |" in documents["brd_markdown"]
    assert "| Date | 9 October 2026 |" in documents["brd_markdown"]
    assert "| **Author** | Puja Rachchh |" in documents["tsd_markdown"]


def test_documents_without_a_control_table_need_no_user_lookup(monkeypatch):
    def fail(*_args, **_kwargs):
        raise AssertionError("looked up a user for a document with nothing to fill")

    monkeypatch.setattr(service.runs_repository, "get_run_owner", fail)
    documents = {"brd_markdown": "# Just a heading", "tsd_markdown": None}
    assert service._with_document_control("20261009-120000-abcdef", documents) == documents


def test_prompts_ask_for_the_placeholders_the_system_fills():
    from brd_agent_suite.prompts.brd_prompt import BRD_INSTRUCTION
    from brd_agent_suite.prompts.tsd_prompt import TSD_INSTRUCTION

    for prompt in (BRD_INSTRUCTION, TSD_INSTRUCTION):
        assert '"[Date]"' in prompt and '"[Author]"' in prompt
