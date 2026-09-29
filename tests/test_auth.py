"""Tests for POST /api/auth/register, /login, /logout and GET /api/auth/me.

All Databricks reads/writes are replaced by tests/conftest.py's fake_store fixture — see its
module docstring for why patching webapp.auth.repository's functions is enough to cover the
whole request path (service.py + dependencies.py both call through the same module).
"""

from webapp.auth.security import hash_password

VALID_PASSWORD = "supersecret123"


def _register(client, name="Ada Lovelace", email="ada@example.com", password=VALID_PASSWORD):
    return client.post("/api/auth/register", json={"name": name, "email": email, "password": password})


def test_register_success(client, fake_store):
    res = _register(client, email="Ada@Example.com")
    assert res.status_code == 201
    body = res.json()
    assert body["email"] == "ada@example.com"  # normalized to lowercase
    assert body["name"] == "Ada Lovelace"
    assert body["role"] == "USER"
    assert body["status"] == "ACTIVE"
    assert "password" not in body
    assert "password_hash" not in body


def test_register_duplicate_email_rejected(client, fake_store):
    _register(client, email="dup@example.com")
    res = _register(client, email="dup@example.com")
    assert res.status_code == 409


def test_register_duplicate_email_case_insensitive(client, fake_store):
    _register(client, email="dup2@example.com")
    res = _register(client, email="DUP2@Example.com")
    assert res.status_code == 409


def test_password_is_hashed_never_stored_plaintext(client, fake_store):
    _register(client, email="grace@example.com", password=VALID_PASSWORD)
    stored = fake_store.get_user_by_email("grace@example.com")
    assert stored is not None
    assert stored["password_hash"] != VALID_PASSWORD
    assert stored["password_hash"].startswith("$argon2id$")


def test_register_rejects_short_password(client, fake_store):
    res = _register(client, email="short@example.com", password="short")
    assert res.status_code == 422


def test_login_success_sets_cookie(client, fake_store):
    _register(client, email="alan@example.com")
    res = client.post("/api/auth/login", json={"email": "alan@example.com", "password": VALID_PASSWORD})
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == "alan@example.com"
    assert "password_hash" not in body
    assert "brd_session" in res.cookies


def test_login_invalid_password_rejected(client, fake_store):
    _register(client, email="alan2@example.com")
    res = client.post("/api/auth/login", json={"email": "alan2@example.com", "password": "wrong-password"})
    assert res.status_code == 401


def test_login_unknown_user_rejected(client, fake_store):
    res = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": VALID_PASSWORD})
    assert res.status_code == 401


def test_login_inactive_user_rejected(client, fake_store):
    created = fake_store.create_user(
        name="Inactive User",
        email="inactive@example.com",
        password_hash=hash_password(VALID_PASSWORD),
        role="USER",
        status="ACTIVE",
    )
    fake_store.users_by_id[created["user_id"]]["status"] = "INACTIVE"
    res = client.post("/api/auth/login", json={"email": "inactive@example.com", "password": VALID_PASSWORD})
    assert res.status_code == 403


def test_me_without_authentication_rejected(client, fake_store):
    res = client.get("/api/auth/me")
    assert res.status_code == 401


def test_me_with_authentication_returns_current_user(client, fake_store):
    _register(client, name="Margaret Hamilton", email="margaret@example.com")
    client.post("/api/auth/login", json={"email": "margaret@example.com", "password": VALID_PASSWORD})
    res = client.get("/api/auth/me")
    assert res.status_code == 200
    body = res.json()
    assert body["email"] == "margaret@example.com"
    assert body["name"] == "Margaret Hamilton"
    assert "password_hash" not in body


def test_logout_clears_session(client, fake_store):
    _register(client, email="katherine@example.com")
    client.post("/api/auth/login", json={"email": "katherine@example.com", "password": VALID_PASSWORD})

    res = client.post("/api/auth/logout")
    assert res.status_code == 200
    assert res.json()["success"] is True

    res = client.get("/api/auth/me")
    assert res.status_code == 401
