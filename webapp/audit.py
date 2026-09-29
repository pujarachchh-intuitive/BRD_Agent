"""Shared audit_logs writer. Not owned by any one feature (auth, projects, generation) — every
part of the app that needs to record an action imports this rather than building its own SQL.

Callers should do `from webapp import audit` and call `audit.insert_audit_log(...)` (not
`from webapp.audit import insert_audit_log`) so that tests can monkeypatch this module's
attribute once and have every caller observe the patched version.
"""

import json
import uuid
from datetime import datetime, timezone
from typing import Optional

from webapp.db import execute, fetch_one, qualified

AUDIT_LOGS_TABLE = qualified("audit_logs")


def has_audit_log(*, entity_type: str, entity_id: str, action: str) -> bool:
    """Used as an idempotency check by one-off scripts (webapp/scripts/migrate_artifacts.py) so
    re-running them doesn't redo work already recorded here."""
    row = fetch_one(
        f"""SELECT audit_id FROM {AUDIT_LOGS_TABLE}
        WHERE entity_type = :entity_type AND entity_id = :entity_id AND action = :action LIMIT 1""",
        {"entity_type": entity_type, "entity_id": entity_id, "action": action},
    )
    return row is not None


def insert_audit_log(
    *,
    user_id: Optional[str],
    action: str,
    entity_type: Optional[str] = None,
    entity_id: Optional[str] = None,
    metadata: Optional[dict] = None,
) -> None:
    execute(
        f"""INSERT INTO {AUDIT_LOGS_TABLE}
        (audit_id, user_id, action, entity_type, entity_id, timestamp, metadata)
        VALUES (:audit_id, :user_id, :action, :entity_type, :entity_id, :timestamp, :metadata)""",
        {
            "audit_id": str(uuid.uuid4()),
            "user_id": user_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "metadata": json.dumps(metadata) if metadata is not None else None,
        },
    )
