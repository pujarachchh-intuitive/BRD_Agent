"""Tests for domain templates (webapp/doc_templates/): content validation, the admin draft ->
publish lifecycle (published versions never change, nothing is deleted), and the generate
endpoint's server-side check that every template item was reviewed."""

import copy
import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from tests.conftest import create_admin_and_login, register_and_login
from webapp import service as generation_service
from webapp.doc_templates import repository as templates_repository
from webapp.doc_templates import service as templates_service
from webapp.doc_templates.schemas import SEEDABLE_FIELDS, TemplateContent

STARTER_DIR = Path(__file__).resolve().parents[1] / "webapp" / "doc_templates" / "starter"


class FakeTemplateStore:
    """Mirrors webapp/doc_templates/repository.py against in-memory lists. Deliberately has no
    delete operation, like the real one."""

    def __init__(self):
        self.domains: list[dict] = []
        self.templates: list[dict] = []
        self.versions: list[dict] = []

    # domains
    def list_domains(self):
        return [dict(d) for d in sorted(self.domains, key=lambda d: (d["sort_order"], d["name"]))]

    def get_domain(self, domain_id):
        return next((dict(d) for d in self.domains if d["domain_id"] == domain_id), None)

    def insert_domain(self, *, domain_id, name, sort_order, created_by):
        row = {"domain_id": domain_id, "name": name, "sort_order": sort_order, "is_active": True, "created_by": created_by}
        self.domains.append(row)
        return dict(row)

    def update_domain(self, domain_id, *, name, sort_order, is_active):
        for d in self.domains:
            if d["domain_id"] == domain_id:
                d.update(name=name, sort_order=sort_order, is_active=is_active)

    # templates
    def list_templates(self):
        return [dict(t) for t in self.templates]

    def get_template(self, template_id):
        return next((dict(t) for t in self.templates if t["template_id"] == template_id), None)

    def get_template_by_slug(self, slug):
        return next((dict(t) for t in self.templates if t["slug"] == slug), None)

    def insert_template(self, *, slug, name, domain_id, description, icon, color, created_by):
        row = {
            "template_id": f"tpl-{len(self.templates) + 1}",
            "slug": slug,
            "name": name,
            "domain_id": domain_id,
            "description": description,
            "icon": icon,
            "color": color,
            "status": "ACTIVE",
            "published_version": None,
            "created_by": created_by,
        }
        self.templates.append(row)
        return dict(row)

    def _template(self, template_id):
        return next(t for t in self.templates if t["template_id"] == template_id)

    def update_template_metadata(self, template_id, **fields):
        self._template(template_id).update(fields)

    def set_template_status(self, template_id, status):
        self._template(template_id)["status"] = status

    def set_published_version(self, template_id, version):
        self._template(template_id)["published_version"] = version

    # versions
    def list_versions(self, template_id):
        rows = [v for v in self.versions if v["template_id"] == template_id]
        return [{k: val for k, val in v.items() if k != "content"} for v in sorted(rows, key=lambda v: -v["version"])]

    def list_all_version_summaries(self):
        return [{k: val for k, val in v.items() if k != "content"} for v in self.versions]

    def get_version(self, template_id, version):
        return next((dict(v) for v in self.versions if v["template_id"] == template_id and v["version"] == version), None)

    def get_draft(self, template_id):
        drafts = [v for v in self.versions if v["template_id"] == template_id and v["status"] == "DRAFT"]
        return dict(max(drafts, key=lambda v: v["version"])) if drafts else None

    def get_max_version(self, template_id):
        return max((v["version"] for v in self.versions if v["template_id"] == template_id), default=0)

    def list_published_with_content(self):
        out = []
        for t in self.templates:
            if t["status"] != "ACTIVE" or t["published_version"] is None:
                continue
            v = self.get_version(t["template_id"], t["published_version"])
            if v and v["status"] == "PUBLISHED":
                out.append({**t, "version": v["version"], "content": v["content"], "published_at": v.get("published_at")})
        return out

    def insert_version(self, *, template_id, version, content, change_note, created_by):
        self.versions.append(
            {
                "template_id": template_id,
                "version": version,
                "status": "DRAFT",
                "content": content,
                "change_note": change_note,
                "created_by": created_by,
            }
        )

    def update_draft_content(self, *, template_id, version, content, change_note, updated_by):
        for v in self.versions:
            if v["template_id"] == template_id and v["version"] == version and v["status"] == "DRAFT":
                v.update(content=content, change_note=change_note, updated_by=updated_by)

    def publish_version(self, *, template_id, version, change_note, published_by):
        for v in self.versions:
            if v["template_id"] == template_id and v["version"] == version and v["status"] == "DRAFT":
                v.update(status="PUBLISHED", change_note=change_note, published_by=published_by, published_at="now")


@pytest.fixture
def fake_templates(monkeypatch):
    store = FakeTemplateStore()
    for name in [n for n in dir(store) if not n.startswith("_")]:
        if hasattr(templates_repository, name) and callable(getattr(store, name)):
            monkeypatch.setattr(templates_repository, name, getattr(store, name))
    templates_service.invalidate_cache()
    store.insert_domain(domain_id="healthcare", name="Healthcare", sort_order=10, created_by="test")
    store.insert_domain(domain_id="financial_services", name="Financial Services", sort_order=20, created_by="test")
    yield store
    templates_service.invalidate_cache()


CONTENT = {
    "domain_guidance": "Assume US HIPAA rules apply when PHI is handled. Never invent section numbers.",
    "questions": [{"key": "handles_phi", "text": "Does the system handle PHI?", "default": True}],
    "items": {
        "non_functional_requirements": [
            {
                "key": "nfr-audit",
                "values": {"category": "Auditability", "requirement": "Record activity in systems containing ePHI."},
                "tag": "regulatory",
                "source": "HIPAA Security Rule, 45 CFR 164.312(b)",
                "source_url": "https://www.ecfr.gov/current/title-45/section-164.312",
                "applies_if": "handles_phi",
            }
        ],
        "risks": [
            {
                "key": "risk-scope",
                "values": {"risk": "Scope creep", "impact": "Medium", "mitigation": "Change control"},
                "tag": "best_practice",
                "source": "Industry practice",
                "source_url": None,
                "applies_if": None,
            }
        ],
        "open_questions": [
            {
                "key": "oq-entity",
                "values": {"text": "Is the organization a covered entity or a business associate?"},
                "tag": "best_practice",
                "source": "",
                "source_url": None,
                "applies_if": None,
            }
        ],
    },
}


def _content(**changes):
    data = copy.deepcopy(CONTENT)
    data.update(changes)
    return data


# ---------- Content validation ----------


def test_seedable_fields_are_real_form_fields():
    form_fields = dict(generation_service.FORM_FIELDS)
    for field in SEEDABLE_FIELDS:
        assert field in form_fields
        assert form_fields[field] in ("list_obj", "list_str")
    for identity in ("project_name", "problem_statement", "doc_id_acronym", "business_context", "objectives"):
        assert identity not in SEEDABLE_FIELDS


def test_valid_content_passes():
    content = TemplateContent.model_validate(CONTENT)
    assert {f for f, _ in content.all_items()} == {"non_functional_requirements", "risks", "open_questions"}


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda c: c["items"].update(project_name=[]), "can't be pre-filled"),
        (lambda c: c["items"]["risks"][0]["values"].update(impact="Critical"), "impact"),
        (lambda c: c["items"]["risks"][0]["values"].pop("mitigation"), "must have exactly"),
        (lambda c: c["items"]["risks"][0].update(applies_if="nope"), "unknown question"),
        (lambda c: c["items"]["risks"][0].update(key="nfr-audit"), "more than once"),
        (lambda c: c.update(domain_guidance="Use {state} here"), "curly braces"),
        (lambda c: c["items"]["risks"][0]["values"].update(risk="a {b}"), "curly braces"),
        (lambda c: c["items"]["risks"][0].update(source_url="http://insecure.example"), "https://"),
        (lambda c: c["items"]["risks"][0]["values"].update(risk="   "), "empty"),
    ],
)
def test_invalid_content_is_rejected(mutate, message):
    data = copy.deepcopy(CONTENT)
    mutate(data)
    with pytest.raises(ValidationError) as exc:
        TemplateContent.model_validate(data)
    assert message in str(exc.value)


def test_required_items_follow_applicability_answers():
    content = TemplateContent.model_validate(CONTENT)
    assert content.required_item_keys({}) == {"nfr-audit", "risk-scope", "oq-entity"}  # default: yes
    assert content.required_item_keys({"handles_phi": False}) == {"risk-scope", "oq-entity"}


@pytest.mark.parametrize("path", sorted(STARTER_DIR.glob("*.json")), ids=lambda p: p.name)
def test_starter_templates_are_valid(path):
    from webapp.doc_templates.schemas import TemplateCreateRequest

    data = json.loads(path.read_text(encoding="utf-8"))
    request = TemplateCreateRequest.model_validate(data)
    assert request.content.items, "a starter template must offer at least one item"
    for _, item in request.content.all_items():
        assert item.source, f"{path.name}: item '{item.key}' must name its source"


# ---------- Admin lifecycle ----------


def test_template_routes_have_no_delete():
    from webapp.server import app

    for route in app.routes:
        if getattr(route, "path", "").startswith(("/api/templates", "/api/admin", "/api/domains")):
            assert "DELETE" not in route.methods


def test_non_admin_cannot_use_template_studio(client, fake_templates):
    register_and_login(client, name="User", email="user-tpl1@example.com")
    assert client.get("/api/admin/templates").status_code == 403
    res = client.post("/api/admin/templates", json={"name": "X", "domain_id": "healthcare"})
    assert res.status_code == 403


def test_create_publish_and_version_history(client, fake_store, fake_templates):
    create_admin_and_login(client, fake_store)

    created = client.post(
        "/api/admin/templates",
        json={"name": "Healthcare", "domain_id": "healthcare", "icon": "health", "color": "#0f9d8a", "content": CONTENT},
    )
    assert created.status_code == 201, created.text
    template_id = created.json()["template"]["template_id"]
    assert created.json()["draft"]["version"] == 1
    # A draft is invisible to users until published.
    assert client.get("/api/templates").json()["templates"] == []

    published = client.post(f"/api/admin/templates/{template_id}/publish", json={"change_note": "First"})
    assert published.status_code == 200, published.text
    assert published.json()["template"]["published_version"] == 1
    listed = client.get("/api/templates").json()["templates"]
    assert [t["template_id"] for t in listed] == [template_id]
    assert listed[0]["counts"] == {"non_functional_requirements": 1, "risks": 1, "open_questions": 1}

    # Editing after publishing starts version 2; version 1 is never changed.
    v1_before = copy.deepcopy(fake_templates.get_version(template_id, 1))
    changed = _content(domain_guidance="Updated guidance.")
    saved = client.put(f"/api/admin/templates/{template_id}/draft", json={"content": changed})
    assert saved.status_code == 200, saved.text
    assert saved.json()["draft"]["version"] == 2
    client.put(f"/api/admin/templates/{template_id}/draft", json={"content": _content(domain_guidance="Again.")})
    assert fake_templates.get_version(template_id, 1) == v1_before
    assert len(fake_templates.versions) == 2  # saving twice edits the one draft, nothing else

    client.post(f"/api/admin/templates/{template_id}/publish", json={})
    assert fake_templates.get_version(template_id, 1) == v1_before
    assert client.get("/api/templates").json()["templates"][0]["version"] == 2

    # Restoring version 1 copies it into a new draft (v3); every older version stays.
    restored = client.post(f"/api/admin/templates/{template_id}/versions/1/restore")
    assert restored.status_code == 200
    assert restored.json()["draft"]["version"] == 3
    assert restored.json()["draft"]["content"]["domain_guidance"] == CONTENT["domain_guidance"]
    assert [v["version"] for v in restored.json()["versions"]] == [3, 2, 1]


def test_retire_hides_template_and_reactivate_restores_it(client, fake_store, fake_templates):
    create_admin_and_login(client, fake_store)
    template_id = client.post(
        "/api/admin/templates", json={"name": "Finance", "domain_id": "financial_services", "content": CONTENT}
    ).json()["template"]["template_id"]
    client.post(f"/api/admin/templates/{template_id}/publish", json={})

    client.post(f"/api/admin/templates/{template_id}/retire")
    assert client.get("/api/templates").json()["templates"] == []
    assert len(fake_templates.templates) == 1  # retired, not deleted

    client.post(f"/api/admin/templates/{template_id}/reactivate")
    assert len(client.get("/api/templates").json()["templates"]) == 1


def test_invalid_content_is_rejected_by_the_api(client, fake_store, fake_templates):
    create_admin_and_login(client, fake_store)
    bad = _content(items={"project_name": []})
    res = client.post("/api/admin/templates", json={"name": "Bad", "domain_id": "healthcare", "content": bad})
    assert res.status_code == 422
    assert fake_templates.templates == []


def test_unknown_domain_is_rejected(client, fake_store, fake_templates):
    create_admin_and_login(client, fake_store)
    res = client.post("/api/admin/templates", json={"name": "X", "domain_id": "nowhere"})
    assert res.status_code == 422


def test_domains_can_be_added_and_hidden_not_deleted(client, fake_store, fake_templates):
    create_admin_and_login(client, fake_store)
    created = client.post("/api/admin/domains", json={"name": "Agritech"})
    assert created.status_code == 201
    domain_id = created.json()["domain_id"]
    assert domain_id == "agritech"
    assert client.post("/api/admin/domains", json={"name": "agritech"}).status_code == 409

    client.patch(f"/api/admin/domains/{domain_id}", json={"is_active": False})
    assert domain_id not in [d["domain_id"] for d in client.get("/api/domains").json()["domains"]]
    assert any(d["domain_id"] == domain_id for d in fake_templates.domains)


# ---------- Generation ----------


@pytest.fixture
def captured_generation(monkeypatch):
    """Replaces the LLM pipeline: records what generate_from_form passed to it."""
    calls: list[dict] = []

    async def fake_run_form_generation(form, auto_fields, excluded_sections, **kwargs):
        calls.append({"form": form, **kwargs})
        return {"run_id": "20260101-000000-tpltst", "project_id": kwargs["project"]["project_id"]}

    monkeypatch.setattr(generation_service, "run_form_generation", fake_run_form_generation)
    return calls


def _published_template(client, fake_store):
    create_admin_and_login(client, fake_store)
    template_id = client.post(
        "/api/admin/templates", json={"name": "Healthcare", "domain_id": "healthcare", "content": CONTENT}
    ).json()["template"]["template_id"]
    client.post(f"/api/admin/templates/{template_id}/publish", json={})
    return template_id


def test_generate_rejects_unreviewed_template_items(client, fake_store, fake_templates, fake_projects, captured_generation):
    template_id = _published_template(client, fake_store)
    res = client.post(
        "/api/generate",
        json={
            "form": {"project_name": "P"},
            "template": {"template_id": template_id, "version": 1, "decisions": {"risk-scope": "accepted"}},
        },
    )
    assert res.status_code == 422
    assert "2 template items still need your review" in res.json()["detail"]
    assert captured_generation == []
    assert fake_projects.projects_by_id == {}  # no empty project left behind


def test_generate_with_every_item_reviewed(client, fake_store, fake_templates, fake_audit, captured_generation):
    template_id = _published_template(client, fake_store)
    decisions = {"nfr-audit": "edited", "risk-scope": "accepted", "oq-entity": "rejected"}
    res = client.post(
        "/api/generate",
        json={"form": {"project_name": "P"}, "template": {"template_id": template_id, "version": 1, "decisions": decisions}},
    )
    assert res.status_code == 200, res.text
    call = captured_generation[0]
    assert call["extra_metadata"]["template"]["decisions"] == dict(sorted(decisions.items()))
    assert call["extra_metadata"]["template"]["summary"] == {"accepted": 1, "edited": 1, "rejected": 1}
    assert call["extra_metadata"]["domain"] == {"domain_id": "healthcare", "name": "Healthcare"}
    assert "Domain: Healthcare" in call["domain_context"]
    assert CONTENT["domain_guidance"] in call["domain_context"]
    assert any(e["action"] == "TEMPLATE_APPLIED" for e in fake_audit.entries)


def test_generate_skips_items_whose_question_was_answered_no(client, fake_store, fake_templates, captured_generation):
    template_id = _published_template(client, fake_store)
    res = client.post(
        "/api/generate",
        json={
            "form": {"project_name": "P"},
            "template": {
                "template_id": template_id,
                "version": 1,
                "answers": {"handles_phi": False},
                "decisions": {"risk-scope": "accepted", "oq-entity": "accepted"},
            },
        },
    )
    assert res.status_code == 200, res.text


def test_generate_rejects_unknown_item_and_unpublished_version(client, fake_store, fake_templates, captured_generation):
    template_id = _published_template(client, fake_store)
    all_reviewed = {"nfr-audit": "accepted", "risk-scope": "accepted", "oq-entity": "accepted"}
    res = client.post(
        "/api/generate",
        json={
            "form": {},
            "template": {"template_id": template_id, "version": 1, "decisions": {**all_reviewed, "made-up": "accepted"}},
        },
    )
    assert res.status_code == 422
    client.put(f"/api/admin/templates/{template_id}/draft", json={"content": CONTENT})  # v2 is only a draft
    res = client.post(
        "/api/generate", json={"form": {}, "template": {"template_id": template_id, "version": 2, "decisions": all_reviewed}}
    )
    assert res.status_code == 422
    assert captured_generation == []


def test_generate_with_domain_only(client, fake_templates, captured_generation):
    register_and_login(client, name="User", email="user-tpl2@example.com")
    res = client.post("/api/generate", json={"form": {"project_name": "P"}, "domain": {"domain_id": "healthcare"}})
    assert res.status_code == 200, res.text
    assert captured_generation[0]["extra_metadata"] == {"domain": {"domain_id": "healthcare", "name": "Healthcare"}}

    res = client.post("/api/generate", json={"form": {"project_name": "P"}, "domain": {"other": "  Agri{tech}\n "}})
    assert res.status_code == 200, res.text
    assert captured_generation[1]["extra_metadata"] == {"domain": {"other": "Agritech"}}
    assert "Agritech" in captured_generation[1]["domain_context"]

    res = client.post("/api/generate", json={"form": {}, "domain": {"domain_id": "nowhere"}})
    assert res.status_code == 422
    res = client.post("/api/generate", json={"form": {}, "domain": {"domain_id": "healthcare", "other": "x"}})
    assert res.status_code == 422


def test_generate_without_template_or_domain_is_unchanged(client, fake_templates, captured_generation):
    register_and_login(client, name="User", email="user-tpl3@example.com")
    res = client.post("/api/generate", json={"form": {"project_name": "P"}})
    assert res.status_code == 200, res.text
    assert captured_generation[0]["extra_metadata"] is None
    assert captured_generation[0]["domain_context"] is None
