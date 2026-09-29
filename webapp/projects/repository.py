"""Data-access layer for the `projects` table."""

import uuid
from datetime import datetime, timezone
from typing import Optional

from webapp.db import execute, fetch_all, fetch_one, qualified

PROJECTS_TABLE = qualified("projects")


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def create_project(*, user_id: str, project_name: str, is_legacy: bool = False, status: str = "ACTIVE") -> dict:
    project_id = str(uuid.uuid4())
    now = _now_iso()
    execute(
        f"""INSERT INTO {PROJECTS_TABLE}
        (project_id, user_id, project_name, status, is_legacy, created_at, updated_at)
        VALUES (:project_id, :user_id, :project_name, :status, :is_legacy, :created_at, :updated_at)""",
        {
            "project_id": project_id,
            "user_id": user_id,
            "project_name": project_name,
            "status": status,
            "is_legacy": is_legacy,
            "created_at": now,
            "updated_at": now,
        },
    )
    return {
        "project_id": project_id,
        "user_id": user_id,
        "project_name": project_name,
        "status": status,
        "is_legacy": is_legacy,
        "created_at": now,
        "updated_at": now,
    }


def get_project_by_id(project_id: str) -> Optional[dict]:
    return fetch_one(f"SELECT * FROM {PROJECTS_TABLE} WHERE project_id = :project_id", {"project_id": project_id})


def list_projects_for_user(user_id: str) -> list[dict]:
    return fetch_all(
        f"SELECT * FROM {PROJECTS_TABLE} WHERE user_id = :user_id ORDER BY created_at DESC", {"user_id": user_id}
    )


def list_all_projects() -> list[dict]:
    return fetch_all(f"SELECT * FROM {PROJECTS_TABLE} ORDER BY created_at DESC")


def rename_project(project_id: str, project_name: str) -> None:
    execute(
        f"UPDATE {PROJECTS_TABLE} SET project_name = :project_name, updated_at = :now WHERE project_id = :project_id",
        {"project_name": project_name, "now": _now_iso(), "project_id": project_id},
    )
