"""Data-access layer for the template tables: `template_domains`, `document_templates` and
`document_template_versions`.

Nothing here ever deletes a row. A retired template or deactivated domain is a status flag, and a
PUBLISHED version row is never written again — only a DRAFT row's content can change (and
update_draft_content's WHERE clause enforces that at the SQL level, not just in the service).
"""

import uuid
from datetime import datetime, timezone
from typing import Optional

from webapp.db import execute, fetch_all, fetch_one, qualified

DOMAINS_TABLE = qualified("template_domains")
TEMPLATES_TABLE = qualified("document_templates")
VERSIONS_TABLE = qualified("document_template_versions")

# Run by webapp/scripts/setup_templates.py. IF NOT EXISTS: running it against a warehouse that
# already has these tables changes nothing.
CREATE_TABLE_STATEMENTS = [
    f"""CREATE TABLE IF NOT EXISTS {DOMAINS_TABLE} (
        domain_id STRING NOT NULL,
        name STRING NOT NULL,
        sort_order INT,
        is_active BOOLEAN,
        created_by STRING,
        created_at STRING,
        updated_at STRING
    )""",
    f"""CREATE TABLE IF NOT EXISTS {TEMPLATES_TABLE} (
        template_id STRING NOT NULL,
        slug STRING NOT NULL,
        name STRING NOT NULL,
        domain_id STRING,
        description STRING,
        icon STRING,
        color STRING,
        status STRING,
        published_version INT,
        created_by STRING,
        created_at STRING,
        updated_at STRING
    )""",
    f"""CREATE TABLE IF NOT EXISTS {VERSIONS_TABLE} (
        template_id STRING NOT NULL,
        version INT NOT NULL,
        status STRING NOT NULL,
        content STRING,
        change_note STRING,
        created_by STRING,
        created_at STRING,
        updated_by STRING,
        updated_at STRING,
        published_by STRING,
        published_at STRING
    )""",
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ---------- Domains ----------


def list_domains() -> list[dict]:
    return fetch_all(f"SELECT * FROM {DOMAINS_TABLE} ORDER BY sort_order, name")


def get_domain(domain_id: str) -> Optional[dict]:
    return fetch_one(f"SELECT * FROM {DOMAINS_TABLE} WHERE domain_id = :domain_id LIMIT 1", {"domain_id": domain_id})


def insert_domain(*, domain_id: str, name: str, sort_order: int, created_by: str) -> dict:
    now = _now_iso()
    row = {
        "domain_id": domain_id,
        "name": name,
        "sort_order": sort_order,
        "is_active": True,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    execute(
        f"""INSERT INTO {DOMAINS_TABLE}
        (domain_id, name, sort_order, is_active, created_by, created_at, updated_at)
        VALUES (:domain_id, :name, :sort_order, :is_active, :created_by, :created_at, :updated_at)""",
        row,
    )
    return row


def update_domain(domain_id: str, *, name: str, sort_order: int, is_active: bool) -> None:
    execute(
        f"""UPDATE {DOMAINS_TABLE}
        SET name = :name, sort_order = :sort_order, is_active = :is_active, updated_at = :now
        WHERE domain_id = :domain_id""",
        {"name": name, "sort_order": sort_order, "is_active": is_active, "now": _now_iso(), "domain_id": domain_id},
    )


# ---------- Templates ----------


def list_templates() -> list[dict]:
    return fetch_all(f"SELECT * FROM {TEMPLATES_TABLE} ORDER BY name")


def get_template(template_id: str) -> Optional[dict]:
    return fetch_one(
        f"SELECT * FROM {TEMPLATES_TABLE} WHERE template_id = :template_id LIMIT 1", {"template_id": template_id}
    )


def get_template_by_slug(slug: str) -> Optional[dict]:
    return fetch_one(f"SELECT * FROM {TEMPLATES_TABLE} WHERE slug = :slug LIMIT 1", {"slug": slug})


def insert_template(
    *, slug: str, name: str, domain_id: str, description: str, icon: str, color: str, created_by: str
) -> dict:
    now = _now_iso()
    row = {
        "template_id": str(uuid.uuid4()),
        "slug": slug,
        "name": name,
        "domain_id": domain_id,
        "description": description,
        "icon": icon,
        "color": color,
        "status": "ACTIVE",
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
    }
    execute(
        f"""INSERT INTO {TEMPLATES_TABLE}
        (template_id, slug, name, domain_id, description, icon, color, status, published_version,
         created_by, created_at, updated_at)
        VALUES (:template_id, :slug, :name, :domain_id, :description, :icon, :color, :status,
         CAST(NULL AS INT), :created_by, :created_at, :updated_at)""",
        row,
    )
    return {**row, "published_version": None}


def update_template_metadata(
    template_id: str, *, name: str, domain_id: str, description: str, icon: str, color: str
) -> None:
    execute(
        f"""UPDATE {TEMPLATES_TABLE}
        SET name = :name, domain_id = :domain_id, description = :description, icon = :icon,
            color = :color, updated_at = :now
        WHERE template_id = :template_id""",
        {
            "name": name,
            "domain_id": domain_id,
            "description": description,
            "icon": icon,
            "color": color,
            "now": _now_iso(),
            "template_id": template_id,
        },
    )


def set_template_status(template_id: str, status: str) -> None:
    execute(
        f"UPDATE {TEMPLATES_TABLE} SET status = :status, updated_at = :now WHERE template_id = :template_id",
        {"status": status, "now": _now_iso(), "template_id": template_id},
    )


def set_published_version(template_id: str, version: int) -> None:
    execute(
        f"""UPDATE {TEMPLATES_TABLE} SET published_version = :version, updated_at = :now
        WHERE template_id = :template_id""",
        {"version": version, "now": _now_iso(), "template_id": template_id},
    )


# ---------- Versions ----------

_VERSION_SUMMARY_COLUMNS = (
    "template_id, version, status, change_note, created_by, created_at, updated_by, updated_at, published_by, published_at"
)


def list_versions(template_id: str) -> list[dict]:
    """Every version of a template, newest first, without the content."""
    return fetch_all(
        f"""SELECT {_VERSION_SUMMARY_COLUMNS} FROM {VERSIONS_TABLE}
        WHERE template_id = :template_id ORDER BY version DESC""",
        {"template_id": template_id},
    )


def list_all_version_summaries() -> list[dict]:
    """Every version of every template, without the content — one query for the admin list."""
    return fetch_all(f"SELECT {_VERSION_SUMMARY_COLUMNS} FROM {VERSIONS_TABLE} ORDER BY template_id, version DESC")


def get_version(template_id: str, version: int) -> Optional[dict]:
    return fetch_one(
        f"SELECT * FROM {VERSIONS_TABLE} WHERE template_id = :template_id AND version = :version LIMIT 1",
        {"template_id": template_id, "version": version},
    )


def get_draft(template_id: str) -> Optional[dict]:
    return fetch_one(
        f"""SELECT * FROM {VERSIONS_TABLE} WHERE template_id = :template_id AND status = 'DRAFT'
        ORDER BY version DESC LIMIT 1""",
        {"template_id": template_id},
    )


def get_max_version(template_id: str) -> int:
    row = fetch_one(
        f"SELECT MAX(version) AS max_version FROM {VERSIONS_TABLE} WHERE template_id = :template_id",
        {"template_id": template_id},
    )
    return int(row["max_version"]) if row and row.get("max_version") is not None else 0


def list_published_with_content() -> list[dict]:
    """Each ACTIVE template joined to its current published version (content included) — what
    users can pick from. Templates never published are left out."""
    return fetch_all(
        f"""SELECT t.template_id, t.slug, t.name, t.domain_id, t.description, t.icon, t.color,
                   v.version, v.content, v.published_at
            FROM {TEMPLATES_TABLE} t
            JOIN {VERSIONS_TABLE} v ON v.template_id = t.template_id AND v.version = t.published_version
            WHERE t.status = 'ACTIVE' AND v.status = 'PUBLISHED'
            ORDER BY t.name"""
    )


def insert_version(*, template_id: str, version: int, content: str, change_note: str, created_by: str) -> None:
    """Always inserted as a DRAFT; publish_version is the only way a version becomes PUBLISHED."""
    now = _now_iso()
    execute(
        f"""INSERT INTO {VERSIONS_TABLE}
        (template_id, version, status, content, change_note, created_by, created_at, updated_by, updated_at,
         published_by, published_at)
        VALUES (:template_id, :version, 'DRAFT', :content, :change_note, :created_by, :created_at, :created_by,
         :created_at, CAST(NULL AS STRING), CAST(NULL AS STRING))""",
        {
            "template_id": template_id,
            "version": version,
            "content": content,
            "change_note": change_note,
            "created_by": created_by,
            "created_at": now,
        },
    )


def update_draft_content(*, template_id: str, version: int, content: str, change_note: str, updated_by: str) -> None:
    # `status = 'DRAFT'` in the WHERE clause: a published version can't be overwritten even if a
    # caller passes its version number by mistake.
    execute(
        f"""UPDATE {VERSIONS_TABLE}
        SET content = :content, change_note = :change_note, updated_by = :updated_by, updated_at = :now
        WHERE template_id = :template_id AND version = :version AND status = 'DRAFT'""",
        {
            "content": content,
            "change_note": change_note,
            "updated_by": updated_by,
            "now": _now_iso(),
            "template_id": template_id,
            "version": version,
        },
    )


def publish_version(*, template_id: str, version: int, change_note: str, published_by: str) -> None:
    now = _now_iso()
    execute(
        f"""UPDATE {VERSIONS_TABLE}
        SET status = 'PUBLISHED', change_note = :change_note, published_by = :published_by,
            published_at = :now, updated_by = :published_by, updated_at = :now
        WHERE template_id = :template_id AND version = :version AND status = 'DRAFT'""",
        {
            "change_note": change_note,
            "published_by": published_by,
            "now": now,
            "template_id": template_id,
            "version": version,
        },
    )
