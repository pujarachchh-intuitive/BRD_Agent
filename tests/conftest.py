"""Shared test fixtures.

There's no live Databricks warehouse to test against here, so every test runs against
in-memory fakes that implement the same functions as each real repository module
(webapp.auth.repository, webapp.projects.repository, webapp.runs_repository, webapp.audit). The
fakes' functions are monkeypatched directly onto those modules' attributes — every consumer
calls e.g. `repository.get_user_by_email(...)` or `audit.insert_audit_log(...)` through the
module object rather than a `from x import y` alias, specifically so that patching the module's
attribute here is observed by every caller regardless of which file it lives in.
"""

import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Must be set before any auth code runs (webapp/auth/security.py reads these at call time, not
# import time, but setting them up front here keeps every test deterministic).
os.environ.setdefault("AUTH_SECRET", "test-only-secret-do-not-use-in-production")
os.environ.setdefault("APP_ENV", "test")

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from webapp import audit  # noqa: E402
from webapp import documents_repository  # noqa: E402
from webapp import runs_repository  # noqa: E402
from webapp.auth import repository as auth_repository  # noqa: E402
from webapp.auth.security import hash_password  # noqa: E402
from webapp.projects import repository as projects_repository  # noqa: E402

VALID_PASSWORD = "supersecret123"


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


class FakeUserStore:
    """Mirrors webapp/auth/repository.py's function signatures against an in-memory dict."""

    def __init__(self):
        self.users_by_id: dict[str, dict] = {}
        self.audit_logs: list[dict] = []

    def create_user(self, *, name, email, password_hash, role, status):
        user_id = str(uuid.uuid4())
        now = _now_iso()
        self.users_by_id[user_id] = {
            "user_id": user_id,
            "name": name,
            "email": email,
            "password_hash": password_hash,
            "role": role,
            "status": status,
            "created_at": now,
            "updated_at": now,
            "last_login_at": None,
        }
        return {k: v for k, v in self.users_by_id[user_id].items() if k != "password_hash"}

    def get_user_by_email(self, email):
        for user in self.users_by_id.values():
            if user["email"] == email:
                return dict(user)
        return None

    def get_user_by_id(self, user_id):
        user = self.users_by_id.get(user_id)
        return dict(user) if user else None

    def get_active_admin(self):
        for user in self.users_by_id.values():
            if user["role"] == "ADMIN" and user["status"] == "ACTIVE":
                return dict(user)
        return None

    def update_last_login(self, user_id):
        if user_id in self.users_by_id:
            self.users_by_id[user_id]["last_login_at"] = _now_iso()


class FakeAuditLog:
    """Records every audit call instead of writing to Databricks — tests can inspect .entries."""

    def __init__(self):
        self.entries: list[dict] = []

    def insert_audit_log(self, *, user_id, action, entity_type=None, entity_id=None, metadata=None):
        self.entries.append(
            {"user_id": user_id, "action": action, "entity_type": entity_type, "entity_id": entity_id, "metadata": metadata}
        )

    def has_audit_log(self, *, entity_type, entity_id, action):
        return any(
            e["entity_type"] == entity_type and e["entity_id"] == entity_id and e["action"] == action
            for e in self.entries
        )


class FakeProjectStore:
    """Mirrors webapp/projects/repository.py."""

    def __init__(self):
        self.projects_by_id: dict[str, dict] = {}

    def create_project(self, *, user_id, project_name, is_legacy=False, status="ACTIVE"):
        project_id = str(uuid.uuid4())
        now = _now_iso()
        project = {
            "project_id": project_id,
            "user_id": user_id,
            "project_name": project_name,
            "status": status,
            "is_legacy": is_legacy,
            "created_at": now,
            "updated_at": now,
        }
        self.projects_by_id[project_id] = project
        return dict(project)

    def get_project_by_id(self, project_id):
        project = self.projects_by_id.get(project_id)
        return dict(project) if project else None

    def list_projects_for_user(self, user_id):
        return [dict(p) for p in self.projects_by_id.values() if p["user_id"] == user_id]

    def list_all_projects(self):
        return [dict(p) for p in self.projects_by_id.values()]

    def rename_project(self, project_id, project_name):
        if project_id in self.projects_by_id:
            self.projects_by_id[project_id]["project_name"] = project_name
            self.projects_by_id[project_id]["updated_at"] = _now_iso()


class FakeGenerationRunsStore:
    """Mirrors webapp/runs_repository.py — the run_id -> (user_id, project_id) ownership map."""

    def __init__(self):
        self.runs_by_id: dict[str, dict] = {}

    def insert_generation_run(self, *, run_id, user_id, project_id, **_kwargs):
        self.runs_by_id[run_id] = {"user_id": user_id, "project_id": project_id}

    def get_run_owner(self, run_id):
        row = self.runs_by_id.get(run_id)
        return dict(row) if row else None

    def list_run_ids_for_user(self, user_id):
        return {run_id for run_id, row in self.runs_by_id.items() if row["user_id"] == user_id}


class FakeDocumentsTable:
    """Mirrors webapp/documents_repository.py's own building blocks (get_latest_version,
    create_document, get_documents_for_run) plus webapp/db.py's upload_to_volume/
    download_from_volume — deliberately faked at this level (not by replacing
    upload_document_version/download_document_content wholesale) so tests exercise the real
    version-increment and lookup logic in webapp/documents_repository.py, not just that
    something was called. volume_contents backs a real upload->download round trip."""

    def __init__(self):
        self.documents: list[dict] = []
        self.uploads: list[tuple[str, str]] = []  # (local_path, destination_volume_path)
        self.volume_contents: dict[str, bytes] = {}  # destination_volume_path -> bytes

    def get_latest_version(self, project_id, document_type):
        versions = [d["version"] for d in self.documents if d["project_id"] == project_id and d["document_type"] == document_type]
        return max(versions) if versions else 0

    def create_document(self, *, project_id, document_type, version, file_path, file_name, run_id=None, status="ACTIVE"):
        document = {
            "document_id": str(uuid.uuid4()),
            "project_id": project_id,
            "document_type": document_type,
            "version": version,
            "file_path": file_path,
            "file_name": file_name,
            "run_id": run_id,
            "status": status,
        }
        self.documents.append(document)
        return document

    def get_documents_for_run(self, run_id):
        return [dict(d) for d in self.documents if d.get("run_id") == run_id]

    def list_documents_for_project(self, project_id):
        return [dict(d) for d in self.documents if d["project_id"] == project_id]

    def backfill_run_id(self, document_id, run_id):
        for document in self.documents:
            if document["document_id"] == document_id:
                document["run_id"] = run_id
                return

    def upload_to_volume(self, local_path, destination_volume_path):
        self.uploads.append((str(local_path), destination_volume_path))
        self.volume_contents[destination_volume_path] = Path(local_path).read_bytes()

    def download_from_volume(self, source_volume_path):
        return self.volume_contents[source_volume_path]


@pytest.fixture
def fake_documents(monkeypatch):
    store = FakeDocumentsTable()
    monkeypatch.setattr(documents_repository, "get_latest_version", store.get_latest_version)
    monkeypatch.setattr(documents_repository, "create_document", store.create_document)
    monkeypatch.setattr(documents_repository, "get_documents_for_run", store.get_documents_for_run)
    monkeypatch.setattr(documents_repository, "list_documents_for_project", store.list_documents_for_project)
    monkeypatch.setattr(documents_repository, "backfill_run_id", store.backfill_run_id)
    monkeypatch.setattr(documents_repository, "upload_to_volume", store.upload_to_volume)
    monkeypatch.setattr(documents_repository, "download_from_volume", store.download_from_volume)
    return store


@pytest.fixture
def fake_store(monkeypatch):
    store = FakeUserStore()
    monkeypatch.setattr(auth_repository, "create_user", store.create_user)
    monkeypatch.setattr(auth_repository, "get_user_by_email", store.get_user_by_email)
    monkeypatch.setattr(auth_repository, "get_user_by_id", store.get_user_by_id)
    monkeypatch.setattr(auth_repository, "get_active_admin", store.get_active_admin)
    monkeypatch.setattr(auth_repository, "update_last_login", store.update_last_login)
    return store


@pytest.fixture
def fake_audit(monkeypatch):
    fake = FakeAuditLog()
    monkeypatch.setattr(audit, "insert_audit_log", fake.insert_audit_log)
    monkeypatch.setattr(audit, "has_audit_log", fake.has_audit_log)
    # webapp/auth/repository.py re-exports insert_audit_log as its own attribute — patch that
    # too so auth flows (register/login/logout) are covered by the same fake in every test.
    monkeypatch.setattr(auth_repository, "insert_audit_log", fake.insert_audit_log)
    return fake


@pytest.fixture
def fake_projects(monkeypatch):
    store = FakeProjectStore()
    monkeypatch.setattr(projects_repository, "create_project", store.create_project)
    monkeypatch.setattr(projects_repository, "get_project_by_id", store.get_project_by_id)
    monkeypatch.setattr(projects_repository, "list_projects_for_user", store.list_projects_for_user)
    monkeypatch.setattr(projects_repository, "list_all_projects", store.list_all_projects)
    monkeypatch.setattr(projects_repository, "rename_project", store.rename_project)
    return store


@pytest.fixture
def fake_runs(monkeypatch):
    store = FakeGenerationRunsStore()
    monkeypatch.setattr(runs_repository, "insert_generation_run", store.insert_generation_run)
    monkeypatch.setattr(runs_repository, "get_run_owner", store.get_run_owner)
    monkeypatch.setattr(runs_repository, "list_run_ids_for_user", store.list_run_ids_for_user)
    return store


@pytest.fixture
def client_factory(fake_store, fake_audit, fake_projects, fake_runs, fake_documents):
    """Returns a factory for fresh, independently-authenticated TestClient instances sharing the
    same in-memory fakes above — lets a test simulate two different logged-in users at once."""
    from fastapi.testclient import TestClient

    from webapp.server import app

    def _make() -> "TestClient":
        return TestClient(app)

    return _make


@pytest.fixture
def client(client_factory):
    return client_factory()


def register_and_login(client, *, name, email, password=VALID_PASSWORD):
    client.post("/api/auth/register", json={"name": name, "email": email, "password": password})
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    return res.json()


def create_admin_and_login(client, fake_store, *, name="Admin", email="admin@example.com", password=VALID_PASSWORD):
    fake_store.create_user(name=name, email=email, password_hash=hash_password(password), role="ADMIN", status="ACTIVE")
    res = client.post("/api/auth/login", json={"email": email, "password": password})
    return res.json()


@pytest.fixture
def tmp_output_root(tmp_path, monkeypatch):
    """Points webapp.service.OUTPUT_ROOT at a scratch directory so run-detail/export tests can
    write a minimal fake run without touching the real brd_agent_suite/output/ directory."""
    from webapp import service

    monkeypatch.setattr(service, "OUTPUT_ROOT", tmp_path)
    return tmp_path
