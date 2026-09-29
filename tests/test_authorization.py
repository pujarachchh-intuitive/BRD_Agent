"""Tests for project ownership and backend authorization: /api/projects/* and the ownership
checks now in front of /api/generate, /api/runs/*.

Two independently-authenticated TestClient instances (client_factory) simulate "User A" and
"User B" acting against the same in-memory fakes (see tests/conftest.py) — this is what lets a
single test assert that B is rejected from A's data without a real Databricks warehouse.
"""

import json

from tests.conftest import create_admin_and_login, register_and_login
from webapp import documents_repository

VALID_PASSWORD = "supersecret123"


def test_user_can_create_project(client_factory):
    client = client_factory()
    user = register_and_login(client, name="User A", email="usera@example.com")

    res = client.post("/api/projects", json={"project_name": "Alpha Project"})
    assert res.status_code == 201
    body = res.json()
    assert body["project_name"] == "Alpha Project"
    assert body["user_id"] == user["user_id"]
    assert body["is_legacy"] is False
    assert body["status"] == "ACTIVE"


def test_user_can_retrieve_own_project(client_factory):
    client = client_factory()
    register_and_login(client, name="User A", email="usera2@example.com")
    project_id = client.post("/api/projects", json={"project_name": "Alpha Project"}).json()["project_id"]

    res = client.get(f"/api/projects/{project_id}")
    assert res.status_code == 200
    assert res.json()["project_id"] == project_id


def test_other_user_cannot_retrieve_project(client_factory):
    client_a = client_factory()
    register_and_login(client_a, name="User A", email="usera3@example.com")
    project_id = client_a.post("/api/projects", json={"project_name": "Alpha Project"}).json()["project_id"]

    client_b = client_factory()
    register_and_login(client_b, name="User B", email="userb3@example.com")
    res = client_b.get(f"/api/projects/{project_id}")
    assert res.status_code == 404


def test_other_user_cannot_update_project(client_factory):
    client_a = client_factory()
    register_and_login(client_a, name="User A", email="usera4@example.com")
    project_id = client_a.post("/api/projects", json={"project_name": "Alpha Project"}).json()["project_id"]

    client_b = client_factory()
    register_and_login(client_b, name="User B", email="userb4@example.com")
    res = client_b.patch(f"/api/projects/{project_id}", json={"project_name": "Hijacked"})
    assert res.status_code == 404


def test_other_user_cannot_generate_for_project(client_factory):
    client_a = client_factory()
    register_and_login(client_a, name="User A", email="usera5@example.com")
    project_id = client_a.post("/api/projects", json={"project_name": "Alpha Project"}).json()["project_id"]

    client_b = client_factory()
    register_and_login(client_b, name="User B", email="userb5@example.com")
    res = client_b.post(
        "/api/generate",
        json={"form": {}, "auto_fields": [], "excluded_sections": [], "project_id": project_id},
    )
    assert res.status_code == 404  # rejected before the generation pipeline ever runs


def test_other_user_cannot_download_document(client_factory, fake_runs):
    client_a = client_factory()
    user_a = register_and_login(client_a, name="User A", email="usera6@example.com")
    project_id = client_a.post("/api/projects", json={"project_name": "Alpha Project"}).json()["project_id"]
    run_id = "20260101-000000-aaaaaa"
    fake_runs.insert_generation_run(
        run_id=run_id, user_id=user_a["user_id"], project_id=project_id, generation_type="generate", status="success"
    )

    client_b = client_factory()
    register_and_login(client_b, name="User B", email="userb6@example.com")
    res = client_b.post(f"/api/runs/{run_id}/export/brd")
    assert res.status_code in (403, 404)


def test_user_a_cannot_access_user_b_generation_run(client_factory, fake_runs):
    client_a = client_factory()
    register_and_login(client_a, name="User A", email="usera7@example.com")

    client_b = client_factory()
    user_b = register_and_login(client_b, name="User B", email="userb7@example.com")
    project_b_id = client_b.post("/api/projects", json={"project_name": "Bravo Project"}).json()["project_id"]
    run_id = "20260101-000001-bbbbbb"
    fake_runs.insert_generation_run(
        run_id=run_id, user_id=user_b["user_id"], project_id=project_b_id, generation_type="generate", status="success"
    )

    res = client_a.get(f"/api/runs/{run_id}")
    assert res.status_code in (403, 404)


def test_user_a_can_access_own_generation_run(client_factory, fake_runs, fake_documents, tmp_output_root):
    client = client_factory()
    user = register_and_login(client, name="User A", email="usera8@example.com")
    project_id = client.post("/api/projects", json={"project_name": "Alpha Project"}).json()["project_id"]

    run_id = "20260101-000002-cccccc"
    fake_runs.insert_generation_run(
        run_id=run_id, user_id=user["user_id"], project_id=project_id, generation_type="generate", status="success"
    )
    # load_run() reads a run's documents from Databricks, not the local filesystem — seed the
    # fake documents table the same way the real dual-write would, via upload_document_version.
    requirements_path = tmp_output_root / "requirements.json"
    requirements_path.write_text(json.dumps({"project_name": "Alpha Project"}), encoding="utf-8")
    documents_repository.upload_document_version(
        project_id=project_id, document_type="REQUIREMENTS_JSON", local_path=requirements_path, run_id=run_id
    )

    res = client.get(f"/api/runs/{run_id}")
    assert res.status_code == 200
    assert res.json()["run_id"] == run_id


def test_admin_can_access_user_a_project(client_factory, fake_store):
    client_a = client_factory()
    register_and_login(client_a, name="User A", email="usera9@example.com")
    project_a_id = client_a.post("/api/projects", json={"project_name": "Alpha Project"}).json()["project_id"]

    admin_client = client_factory()
    create_admin_and_login(admin_client, fake_store, email="admin9@example.com")
    res = admin_client.get(f"/api/projects/{project_a_id}")
    assert res.status_code == 200


def test_admin_can_access_user_b_project(client_factory, fake_store):
    client_b = client_factory()
    register_and_login(client_b, name="User B", email="userb10@example.com")
    project_b_id = client_b.post("/api/projects", json={"project_name": "Bravo Project"}).json()["project_id"]

    admin_client = client_factory()
    create_admin_and_login(admin_client, fake_store, email="admin10@example.com")
    res = admin_client.get(f"/api/projects/{project_b_id}")
    assert res.status_code == 200


def test_user_id_cannot_be_spoofed_on_project_creation(client_factory):
    client = client_factory()
    user = register_and_login(client, name="User A", email="usera11@example.com")

    res = client.post("/api/projects", json={"project_name": "Alpha Project", "user_id": "someone-else"})
    assert res.status_code == 201
    assert res.json()["user_id"] == user["user_id"]
    assert res.json()["user_id"] != "someone-else"


def test_unauthenticated_cannot_access_protected_endpoints(client_factory):
    client = client_factory()

    assert client.post("/api/projects", json={"project_name": "X"}).status_code == 401
    assert client.get("/api/projects").status_code == 401
    assert client.get("/api/runs").status_code == 401
    assert client.post("/api/generate", json={"form": {}, "auto_fields": [], "excluded_sections": []}).status_code == 401
