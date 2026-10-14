"""Tests for the document-upload flow (webapp/ingestion/): parsing and validation, evidence
verification and gap tiering, and the extract -> review -> generate endpoints.

No LLM is ever called: ingestion.service._call_agent (extraction) and
webapp.service.run_pipeline_and_write (generation) are replaced with fakes. Databricks is faked by
the shared fixtures in tests/conftest.py.
"""

import io
import json
import shutil
import zipfile

import pytest
from pypdf import PdfWriter

from brd_agent_suite.document_schema import ExtractedForm
from brd_agent_suite.field_guide import FIELD_GUIDE
from tests.conftest import register_and_login
from tests.test_doc_templates import _published_template, fake_templates  # noqa: F401 — fixture
from webapp import jobs
from webapp import service as core
from webapp.branding.docx_export import find_pandoc
from webapp.ingestion import parsers, verify
from webapp.ingestion import service as ingestion_service
from webapp.ingestion.parsers import UploadRejected

PROJECT_TEXT = (
    "Project ClaimsHub. The claims team spends too long re-keying paper forms into the core system. "
    "Adjusters need a single queue of open claims. The system shall let adjusters upload photos. "
    "Sponsor: Head of Claims Operations."
)


# ---------------------------------------------------------------------------------------------
# Sample files
# ---------------------------------------------------------------------------------------------


def _text_pdf(text: str) -> bytes:
    content = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream",
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for number, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + obj + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return out


def _blank_pdf(password: str | None = None) -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=612, height=792)
    if password:
        writer.encrypt(user_password=password, owner_password="owner", algorithm="RC4-128")
    buffer = io.BytesIO()
    writer.write(buffer)
    return buffer.getvalue()


def _docx(paragraph: str, *, extra_entries: dict[str, str] | None = None, include_document: bool = True) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/word/document.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        )
        archive.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
            'Target="word/document.xml"/></Relationships>',
        )
        if include_document:
            archive.writestr(
                "word/document.xml",
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
                f"<w:p><w:r><w:t>{paragraph}</w:t></w:r></w:p></w:body></w:document>",
            )
        for name, content in (extra_entries or {}).items():
            archive.writestr(name, content)
    return buffer.getvalue()


# ---------------------------------------------------------------------------------------------
# Parsing and validation
# ---------------------------------------------------------------------------------------------


def test_text_and_markdown_are_decoded():
    doc = parsers.parse_document("notes.md", "# Notes\r\nAdjusters need a queue.".encode("utf-8-sig"))
    assert doc.kind == "md"
    assert doc.text == "# Notes\nAdjusters need a queue."
    assert not doc.needs_native


def test_text_pdf_is_extracted_with_page_markers():
    doc = parsers.parse_document("sow.pdf", _text_pdf("The system shall let adjusters upload photos of damaged vehicles."))
    assert doc.page_count == 1
    assert "--- Page 1 ---" in doc.text
    assert "upload photos" in doc.text
    assert not doc.needs_native


def test_pdf_without_text_layer_is_sent_natively():
    doc = parsers.parse_document("scan.pdf", _blank_pdf())
    assert doc.needs_native
    assert doc.text == ""
    assert doc.raw.startswith(b"%PDF")


def test_password_protected_pdf_is_rejected():
    with pytest.raises(UploadRejected, match="password-protected"):
        parsers.parse_document("locked.pdf", _blank_pdf(password="secret"))


def test_file_that_is_not_really_a_pdf_is_rejected():
    with pytest.raises(UploadRejected, match="isn't a valid PDF"):
        parsers.parse_document("fake.pdf", b"just some text")


def _has_pandoc() -> bool:
    try:
        find_pandoc()
    except RuntimeError:
        return False
    return True


@pytest.mark.skipif(not _has_pandoc(), reason="pandoc not installed")
def test_docx_is_converted_with_pandoc():
    doc = parsers.parse_document("brief.docx", _docx("Adjusters need a single queue of open claims."))
    assert doc.kind == "docx"
    assert "single queue of open claims" in doc.text


def test_docx_with_macros_is_rejected():
    with pytest.raises(UploadRejected, match="macros"):
        parsers.parse_document("brief.docx", _docx("Hi", extra_entries={"word/vbaProject.bin": "x"}))


def test_zip_that_is_not_a_docx_is_rejected():
    with pytest.raises(UploadRejected, match="isn't a valid DOCX"):
        parsers.parse_document("brief.docx", _docx("Hi", include_document=False))


def test_legacy_doc_is_rejected_with_save_as_hint():
    with pytest.raises(UploadRejected, match="Save As"):
        parsers.parse_document("old.doc", b"\xd0\xcf\x11\xe0")


def test_unsupported_type_is_rejected():
    with pytest.raises(UploadRejected, match="unsupported file type"):
        parsers.parse_document("sheet.xlsx", b"PK\x03\x04")


def test_safe_file_name_strips_directories_and_odd_characters():
    assert parsers.safe_file_name("..\\..\\etc/My SOW (final).PDF") == "My_SOW_final.pdf"
    assert parsers.safe_file_name("") == "document"


def test_field_guide_and_extraction_schema_match_the_form():
    form_fields = {name for name, _ in core.FORM_FIELDS}
    assert {entry.field for entry in FIELD_GUIDE} == form_fields
    assert set(ExtractedForm.model_fields) == form_fields


# ---------------------------------------------------------------------------------------------
# Evidence verification and gap tiering
# ---------------------------------------------------------------------------------------------


def test_quote_matching_tolerates_formatting_but_not_paraphrase():
    source = verify._normalize("The system SHALL let adjusters upload photos.\nIt must re-\nquire approval for claims over $10,000.")
    assert verify.quote_found("the system shall let adjusters upload photos", source)
    assert verify.quote_found("The system shall let adjusters... upload photos", source)
    assert verify.quote_found("It must require approval for claims over $10,000", source)
    assert not verify.quote_found("Adjusters can attach pictures to a claim", source)


def _extraction(form: dict, reports: list[dict], **extra) -> dict:
    return {"form": form, "field_reports": reports, **extra}


def _field(review: dict, name: str) -> dict:
    return next(f for f in review["fields"] if f["field"] == name)


def test_review_tiers_each_field():
    sources = {"sow.txt": PROJECT_TEXT, "scan.pdf": None}
    extraction = _extraction(
        {
            "project_name": "ClaimsHub",
            "problem_statement": "The claims team spends too long re-keying paper forms.",
            "stakeholders": [{"role": "Head of Claims Operations", "interest": "Sponsor"}],
            "target_users": [{"persona": "Adjusters", "needs": "A single queue"}],
            "business_context": "Paper-heavy process.",
            "decision_audience": "Steering committee",
            "integrations": ["Core claims system"],
        },
        [
            {"field": "project_name", "status": "found", "confidence": "high",
             "evidence": [{"file": "sow.txt", "location": "p.1", "quote": "Project ClaimsHub"}]},
            {"field": "problem_statement", "status": "found", "confidence": "high",
             "evidence": [{"file": "sow.txt", "quote": "spends too long re-keying paper forms into the core system"}]},
            {"field": "stakeholders", "status": "found", "confidence": "high",
             "evidence": [{"file": "sow.txt", "quote": "Sponsor: Head of Claims Operations."}]},
            {"field": "target_users", "status": "partial", "confidence": "medium",
             "evidence": [{"file": "sow.txt", "quote": "Adjusters need a single queue of open claims"}]},
            {"field": "business_context", "status": "found", "confidence": "low",
             "evidence": [{"file": "sow.txt", "quote": "paper forms"}]},
            {"field": "decision_audience", "status": "found", "confidence": "high",
             "evidence": [{"file": "sow.txt", "quote": "The steering committee approves the budget"}]},
            {"field": "integrations", "status": "found", "confidence": "high",
             "evidence": [{"file": "scan.pdf", "location": "p.2", "quote": "Integrates with the core claims system"}]},
        ],
        gap_questions=[{"field": "target_users", "question": "Which adjusters?", "suggested_answers": ["Field adjusters: mobile", "Field adjusters: mobile", ""]}],
    )
    review = verify.build_review(extraction, sources)

    assert _field(review, "project_name")["state"] == "found"
    assert _field(review, "project_name")["evidence"][0]["verified"] is True
    assert _field(review, "target_users")["state"] == "blocking"  # partial + critical
    assert _field(review, "functional_requirements")["state"] == "blocking"  # missing + critical
    assert _field(review, "business_context")["state"] == "confirm"  # low confidence
    assert _field(review, "decision_audience")["state"] == "confirm"  # quote not in the source
    assert _field(review, "integrations")["state"] == "found"  # scanned source: can't check, not penalized
    assert _field(review, "integrations")["evidence"][0]["verified"] is None
    assert _field(review, "risks")["state"] == "auto"  # missing, not critical
    assert _field(review, "additional_sections")["state"] == "optional"

    assert review["blocking"] == ["target_users", "functional_requirements"]
    assert "risks" in review["auto_fields"]
    # Every blocking field gets a question: the model's own one, deduplicated, or a fallback.
    by_field = {q["field"]: q for q in review["gap_questions"]}
    assert by_field["target_users"]["suggested_answers"] == ["Field adjusters: mobile"]
    assert "key features" in by_field["functional_requirements"]["question"]
    assert [q["field"] for q in review["gap_questions"][:2]] == ["target_users", "functional_requirements"]


def test_conflicting_field_needs_confirmation():
    extraction = _extraction(
        {"project_name": "ClaimsHub"},
        [{"field": "project_name", "status": "found", "confidence": "high",
          "evidence": [{"file": "sow.txt", "quote": "Project ClaimsHub"}]}],
        conflicts=[{"field": "project_name", "description": "Two names", "options": [{"value": "ClaimsHub", "file": "sow.txt"}, {"value": "", "file": "x"}]}],
    )
    review = verify.build_review(extraction, {"sow.txt": PROJECT_TEXT})
    assert _field(review, "project_name")["state"] == "confirm"
    assert review["conflicts"][0]["options"] == [{"value": "ClaimsHub", "file": "sow.txt"}]


# ---------------------------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------------------------


GOOD_EXTRACTION = _extraction(
    {
        "project_name": "ClaimsHub",
        "problem_statement": "The claims team spends too long re-keying paper forms into the core system.",
        "stakeholders": [{"role": "Head of Claims Operations", "interest": "Sponsor"}],
        "functional_requirements": [{"description": "Let adjusters upload photos", "priority": "M"}],
    },
    [
        {"field": "project_name", "status": "found", "confidence": "high",
         "evidence": [{"file": "sow.txt", "quote": "Project ClaimsHub"}]},
        {"field": "problem_statement", "status": "found", "confidence": "high",
         "evidence": [{"file": "sow.txt", "quote": "spends too long re-keying paper forms"}]},
        {"field": "stakeholders", "status": "found", "confidence": "high",
         "evidence": [{"file": "sow.txt", "quote": "Sponsor: Head of Claims Operations"}]},
        {"field": "functional_requirements", "status": "found", "confidence": "high",
         "evidence": [{"file": "sow.txt", "quote": "The system shall let adjusters upload photos"}]},
    ],
    summary="An SOW for ClaimsHub.",
    digest="- Budget: 250k",
)


@pytest.fixture
def fake_llm(monkeypatch, tmp_output_root):
    """Replaces the extraction LLM call; .calls records each (kind, parts) it received."""
    jobs.clear_all()
    ingestion_service.upload_limiter.reset()
    ingestion_service._extraction_cache.clear()
    monkeypatch.setattr(jobs, "RUN_EAGERLY", True)

    class FakeLLM:
        def __init__(self):
            self.calls: list[tuple[str, list]] = []
            self.result = GOOD_EXTRACTION

        async def __call__(self, kind, parts, session_id):
            self.calls.append((kind, parts))
            return self.result

    fake = FakeLLM()
    monkeypatch.setattr(ingestion_service, "_call_agent", fake)
    return fake


def _upload(client, *files, **form):
    return client.post(
        "/api/documents/extract",
        files=[("files", (name, data, "application/octet-stream")) for name, data in files],
        data=form,
    )


def test_extract_returns_review_and_stores_everything(client, fake_llm, fake_documents, fake_runs, fake_audit):
    register_and_login(client, name="User A", email="ingest-a@example.com")
    res = _upload(client, ("sow.txt", PROJECT_TEXT.encode()))
    assert res.status_code == 202
    job = res.json()
    assert job["status"] == "succeeded", job["error"]

    result = job["result"]
    assert result["extraction_id"].startswith("ext-")
    assert result["project_name"] == "ClaimsHub"
    assert result["blocking"] == ["target_users"]
    assert result["files"][0]["file_name"] == "sow.txt"
    assert "Project ClaimsHub" in fake_llm.calls[0][1][1].text

    stored_types = sorted(d["document_type"] for d in fake_documents.documents)
    assert stored_types == ["SOURCE_DOCUMENT", "SOURCE_EXTRACTION", "SOURCE_TEXT"]
    assert all(d["run_id"] == result["extraction_id"] for d in fake_documents.documents)
    assert fake_runs.runs_by_id[result["extraction_id"]]["project_id"] == result["project_id"]
    assert any(e["action"] == "SOURCE_UPLOADED" for e in fake_audit.entries)

    # The job is pollable, and the stored extraction can be loaded back.
    assert client.get(f"/api/jobs/{job['job_id']}").json()["status"] == "succeeded"
    loaded = client.get(f"/api/documents/extractions/{result['extraction_id']}")
    assert loaded.status_code == 200
    assert loaded.json()["form"]["project_name"] == "ClaimsHub"


def test_extraction_reloads_from_the_volume_when_not_on_local_disk(client, fake_llm, fake_documents, tmp_output_root):
    register_and_login(client, name="User A", email="ingest-volume@example.com")
    extraction_id = _upload(client, ("sow.txt", PROJECT_TEXT.encode())).json()["result"]["extraction_id"]
    shutil.rmtree(tmp_output_root / extraction_id)

    loaded = client.get(f"/api/documents/extractions/{extraction_id}")
    assert loaded.status_code == 200
    assert loaded.json()["extraction_id"] == extraction_id


def test_other_user_cannot_see_extraction_or_poll_job(client_factory, fake_llm):
    client_a = client_factory()
    register_and_login(client_a, name="User A", email="ingest-owner@example.com")
    job = _upload(client_a, ("sow.txt", PROJECT_TEXT.encode())).json()

    client_b = client_factory()
    register_and_login(client_b, name="User B", email="ingest-other@example.com")
    assert client_b.get(f"/api/jobs/{job['job_id']}").status_code == 404
    assert client_b.get(f"/api/documents/extractions/{job['result']['extraction_id']}").status_code == 404


def test_job_polling_requires_sign_in(client, fake_llm):
    assert client.get("/api/jobs/anything").status_code == 401


def test_bad_file_is_rejected_before_any_llm_call(client, fake_llm):
    register_and_login(client, name="User A", email="ingest-bad@example.com")
    res = _upload(client, ("sow.txt", PROJECT_TEXT.encode()), ("old.doc", b"\xd0\xcf\x11\xe0"))
    assert res.status_code == 400
    assert "old.doc" in res.json()["detail"]
    assert fake_llm.calls == []


def test_too_many_files_are_rejected(client, fake_llm):
    register_and_login(client, name="User A", email="ingest-many@example.com")
    files = [(f"n{i}.txt", f"{PROJECT_TEXT} {i}".encode()) for i in range(parsers.MAX_FILES + 1)]
    assert _upload(client, *files).status_code == 400


def test_same_files_again_reuse_the_earlier_extraction(client, fake_llm):
    register_and_login(client, name="User A", email="ingest-cache@example.com")
    first = _upload(client, ("sow.txt", PROJECT_TEXT.encode())).json()
    second = _upload(client, ("renamed.txt", PROJECT_TEXT.encode())).json()
    assert second["result"]["extraction_id"] == first["result"]["extraction_id"]
    assert len(fake_llm.calls) == 1


def test_daily_upload_limit(client, fake_llm, monkeypatch):
    monkeypatch.setattr(ingestion_service.upload_limiter, "limit", 1)
    register_and_login(client, name="User A", email="ingest-limit@example.com")
    assert _upload(client, ("a.txt", PROJECT_TEXT.encode())).status_code == 202
    res = _upload(client, ("b.txt", (PROJECT_TEXT + " more").encode()))
    assert res.status_code == 429


def test_long_documents_are_extracted_one_by_one_then_merged(client, fake_llm, monkeypatch):
    monkeypatch.setattr(ingestion_service, "SINGLE_CALL_TOKEN_BUDGET", 10)
    register_and_login(client, name="User A", email="ingest-merge@example.com")
    job = _upload(client, ("a.txt", PROJECT_TEXT.encode()), ("b.md", (PROJECT_TEXT + " Phase 2.").encode())).json()
    assert job["result"]["mode"] == "per_document"
    assert [kind for kind, _ in fake_llm.calls] == ["extract", "extract", "merge"]


def test_add_another_document_reextracts_all_files_into_the_same_project(client, fake_llm):
    register_and_login(client, name="User A", email="ingest-add@example.com")
    first = _upload(client, ("sow.txt", PROJECT_TEXT.encode())).json()["result"]
    second = _upload(
        client, ("notes.md", b"Users: field adjusters need mobile access."), extraction_id=first["extraction_id"]
    ).json()["result"]

    assert second["extraction_id"] != first["extraction_id"]
    assert second["project_id"] == first["project_id"]
    assert [f["file_name"] for f in second["files"]] == ["sow.txt", "notes.md"]
    combined_prompt = " ".join(p.text or "" for p in fake_llm.calls[-1][1])
    assert "Project ClaimsHub" in combined_prompt and "mobile access" in combined_prompt


def _reviewed_form() -> dict:
    form = {name: ("" if kind == "scalar" else []) for name, kind in core.FORM_FIELDS}
    form.update(GOOD_EXTRACTION["form"])
    form["target_users"] = [{"persona": "Adjusters", "needs": "A single queue"}]
    form["project_name"] = "ClaimsHub Portal"
    return form


def test_generate_refuses_while_blocking_fields_are_empty(client, fake_llm):
    register_and_login(client, name="User A", email="ingest-gen-422@example.com")
    extraction_id = _upload(client, ("sow.txt", PROJECT_TEXT.encode())).json()["result"]["extraction_id"]
    form = _reviewed_form()
    form["target_users"] = []
    res = client.post(f"/api/documents/extractions/{extraction_id}/generate", json={"form": form, "auto_fields": ["target_users"]})
    assert res.status_code == 422
    assert "Target Users" in res.json()["detail"]


def test_generate_runs_the_form_pipeline_with_source_context(client, fake_llm, fake_runs, fake_projects, monkeypatch):
    captured = {}

    async def fake_pipeline(pipeline, run_id, *, message_text=None, initial_state=None, parent_run_id=None, on_agent_done=None):
        captured["state"] = initial_state
        on_agent_done("brd_agent")
        return {
            "run_id": run_id,
            "files": {},
            "missing": [],
            "duration_seconds": 1.0,
            "requirements_json": {"project_name": initial_state["partial_requirements_json"]["project_name"]},
            "consistency_report": "PASS",
        }

    monkeypatch.setattr(core, "run_pipeline_and_write", fake_pipeline)
    register_and_login(client, name="User A", email="ingest-gen@example.com")
    extraction = _upload(client, ("sow.txt", PROJECT_TEXT.encode())).json()["result"]

    res = client.post(
        f"/api/documents/extractions/{extraction['extraction_id']}/generate",
        json={"form": _reviewed_form(), "auto_fields": ["risks"], "excluded_sections": []},
    )
    assert res.status_code == 202
    job = res.json()
    assert job["status"] == "succeeded", job["error"]
    assert job["progress"] == ["BRD drafted"]

    run_id = job["result"]["run_id"]
    assert job["result"]["project_id"] == extraction["project_id"]
    assert '<source_document file="sow.txt">' in captured["state"]["source_context"]
    assert "Budget: 250k" in captured["state"]["source_context"]
    assert captured["state"]["auto_fields"] == ["risks"]
    assert fake_runs.runs_by_id[run_id]["metadata"].count(extraction["extraction_id"]) == 1
    # The project the extraction created takes the name the user settled on in review.
    assert fake_projects.projects_by_id[extraction["project_id"]]["project_name"] == "ClaimsHub Portal"


def _fake_pipeline_capturing(captured: dict):
    async def fake_pipeline(pipeline, run_id, *, message_text=None, initial_state=None, parent_run_id=None, on_agent_done=None):
        captured["state"] = initial_state
        return {
            "run_id": run_id,
            "files": {},
            "missing": [],
            "duration_seconds": 1.0,
            "requirements_json": {"project_name": initial_state["partial_requirements_json"]["project_name"]},
            "consistency_report": "PASS",
        }

    return fake_pipeline


def test_generate_from_documents_with_a_template(client, fake_llm, fake_runs, fake_store, fake_templates, fake_audit, monkeypatch):
    """A template chosen on New Request travels through the upload flow: its items must all be
    reviewed, and the run records it and passes its guidance to the gap-filler."""
    captured: dict = {}
    monkeypatch.setattr(core, "run_pipeline_and_write", _fake_pipeline_capturing(captured))
    template_id = _published_template(client, fake_store)
    extraction_id = _upload(client, ("sow.txt", PROJECT_TEXT.encode())).json()["result"]["extraction_id"]
    url = f"/api/documents/extractions/{extraction_id}/generate"

    unreviewed = {"template_id": template_id, "version": 1, "decisions": {"risk-scope": "accepted"}}
    res = client.post(url, json={"form": _reviewed_form(), "template": unreviewed})
    assert res.status_code == 422
    assert "still need your review" in res.json()["detail"]
    assert "state" not in captured  # rejected before any job ran

    decisions = {"nfr-audit": "accepted", "risk-scope": "edited", "oq-entity": "rejected"}
    res = client.post(url, json={"form": _reviewed_form(), "template": {**unreviewed, "decisions": decisions}})
    assert res.status_code == 202
    job = res.json()
    assert job["status"] == "succeeded", job["error"]
    assert "Domain: Healthcare" in captured["state"]["domain_context"]
    assert "<source_document" in captured["state"]["source_context"]
    metadata = json.loads(fake_runs.runs_by_id[job["result"]["run_id"]]["metadata"])
    assert metadata["source_extraction_id"] == extraction_id
    assert metadata["template"]["decisions"] == dict(sorted(decisions.items()))
    assert any(e["action"] == "TEMPLATE_APPLIED" for e in fake_audit.entries)


def test_generate_from_documents_with_a_typed_domain(client, fake_llm, fake_runs, fake_templates, monkeypatch):
    captured: dict = {}
    monkeypatch.setattr(core, "run_pipeline_and_write", _fake_pipeline_capturing(captured))
    register_and_login(client, name="User A", email="ingest-domain@example.com")
    extraction_id = _upload(client, ("sow.txt", PROJECT_TEXT.encode())).json()["result"]["extraction_id"]

    res = client.post(
        f"/api/documents/extractions/{extraction_id}/generate", json={"form": _reviewed_form(), "domain": {"other": "Agritech"}}
    )
    assert res.json()["status"] == "succeeded", res.json()["error"]
    assert "Agritech" in captured["state"]["domain_context"]
    metadata = json.loads(fake_runs.runs_by_id[res.json()["result"]["run_id"]]["metadata"])
    assert metadata["domain"] == {"other": "Agritech"}
