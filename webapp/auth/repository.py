"""Data-access layer for the `users` and `audit_logs` Databricks tables. Every read/write to
those tables goes through here — nothing else in the app builds SQL for them, and this is the
single place that changes if the table layout changes.
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from webapp.audit import insert_audit_log  # noqa: F401 -- re-exported: existing call sites do
# `repository.insert_audit_log(...)`; kept as an attribute of this module rather than switched
# over to `webapp.audit`, so tests that monkeypatch `repository.insert_audit_log` keep working.
from webapp.db import execute, fetch_one, qualified

USERS_TABLE = qualified("users")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def get_user_by_email(email: str) -> Optional[dict]:
    """email must already be normalized (lowercased) by the caller."""
    return fetch_one(f"SELECT * FROM {USERS_TABLE} WHERE email = :email", {"email": email})


def get_user_by_id(user_id: str) -> Optional[dict]:
    return fetch_one(f"SELECT * FROM {USERS_TABLE} WHERE user_id = :user_id", {"user_id": user_id})


def get_active_admin() -> Optional[dict]:
    return fetch_one(f"SELECT * FROM {USERS_TABLE} WHERE role = 'ADMIN' AND status = 'ACTIVE' LIMIT 1")


def create_user(*, name: str, email: str, password_hash: str, role: str, status: str) -> dict:
    """Inserts a new user and returns the public-safe fields (no password_hash)."""
    user_id = str(uuid.uuid4())
    now = _now_iso()
    execute(
        f"""INSERT INTO {USERS_TABLE}
        (user_id, name, email, password_hash, role, status, created_at, updated_at, last_login_at)
        VALUES (:user_id, :name, :email, :password_hash, :role, :status, :created_at, :updated_at, NULL)""",
        {
            "user_id": user_id,
            "name": name,
            "email": email,
            "password_hash": password_hash,
            "role": role,
            "status": status,
            "created_at": now,
            "updated_at": now,
        },
    )
    return {
        "user_id": user_id,
        "name": name,
        "email": email,
        "role": role,
        "status": status,
        "created_at": now,
        "updated_at": now,
        "last_login_at": None,
    }


def update_last_login(user_id: str) -> None:
    now = _now_iso()
    execute(
        f"UPDATE {USERS_TABLE} SET last_login_at = :now, updated_at = :now WHERE user_id = :user_id",
        {"now": now, "user_id": user_id},
    )
