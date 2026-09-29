"""Databricks SQL connection layer. Isolates raw SQL access behind a handful of small helpers so
the rest of the application (repositories) never imports the databricks connector directly and
never becomes coupled to connection-management details.

Uses databricks-sql-connector against a SQL warehouse (server hostname + HTTP path + a personal
access token), which is the standard way to run parameterized SQL against Unity Catalog tables
from a Python backend — no ORM, since Delta/Unity Catalog isn't a relational engine SQLAlchemy
targets.
"""

import os
import uuid
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Optional

from databricks import sql as databricks_sql

CATALOG = os.getenv("DATABRICKS_CATALOG", "dbx-ai-agents")
SCHEMA = os.getenv("DATABRICKS_SCHEMA", "brd_generator")
VOLUME = os.getenv("DATABRICKS_VOLUME", "brd_artifacts")

# The Volume upload/download (upload_to_volume/download_from_volume, below) read/write a local
# file via the SQL connector's staging PUT/GET commands, which refuse to touch any path outside
# this allow-list — the whole project root covers OUTPUT_ROOT (brd_agent_suite/output/) and the
# download scratch directory below, regardless of where within it a file lives.
_PROJECT_ROOT = Path(__file__).resolve().parent.parent

# Staging GET always writes its result to a local file (there's no in-memory variant) — this is
# that file's short-lived home; download_from_volume deletes it immediately after reading it back
# into memory, success or failure, so nothing here persists between calls.
_DOWNLOAD_SCRATCH_DIR = _PROJECT_ROOT / ".databricks_downloads"


def qualified(table: str) -> str:
    """Fully-qualified, backtick-quoted table name (the catalog name contains hyphens)."""
    return f"`{CATALOG}`.`{SCHEMA}`.`{table}`"


def volume_path(*segments: str) -> str:
    """Builds a path under this app's Volume, e.g. volume_path(project_id, "BRD", "v1", "BRD.md")
    -> /Volumes/<catalog>/<schema>/<volume>/<project_id>/BRD/v1/BRD.md. Unlike qualified(), this
    is a plain string path (Volume paths aren't SQL identifiers), so no backtick-quoting."""
    return "/Volumes/" + "/".join([CATALOG, SCHEMA, VOLUME, *segments])


def _connection_kwargs() -> dict:
    server_hostname = os.getenv("DATABRICKS_SERVER_HOSTNAME")
    http_path = os.getenv("DATABRICKS_HTTP_PATH")
    access_token = os.getenv("DATABRICKS_TOKEN")
    if not (server_hostname and http_path and access_token):
        raise RuntimeError(
            "Databricks connection is not configured — set DATABRICKS_SERVER_HOSTNAME, "
            "DATABRICKS_HTTP_PATH, and DATABRICKS_TOKEN (see .env.example)."
        )
    return {
        "server_hostname": server_hostname,
        "http_path": http_path,
        "access_token": access_token,
        "staging_allowed_local_path": str(_PROJECT_ROOT),
    }


@contextmanager
def _cursor() -> Iterator[Any]:
    connection = databricks_sql.connect(**_connection_kwargs())
    try:
        cursor = connection.cursor()
        try:
            yield cursor
        finally:
            cursor.close()
    finally:
        connection.close()


def execute(query: str, params: Optional[dict] = None) -> None:
    """Runs a statement with no result set (INSERT/UPDATE)."""
    with _cursor() as cursor:
        cursor.execute(query, params or {})


def fetch_one(query: str, params: Optional[dict] = None) -> Optional[dict]:
    with _cursor() as cursor:
        cursor.execute(query, params or {})
        row = cursor.fetchone()
        if row is None:
            return None
        columns = [c[0] for c in cursor.description]
        return dict(zip(columns, row))


def fetch_all(query: str, params: Optional[dict] = None) -> list[dict]:
    with _cursor() as cursor:
        cursor.execute(query, params or {})
        columns = [c[0] for c in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]


def upload_to_volume(local_path: Path, destination_volume_path: str) -> None:
    """Uploads a local file into the Volume via the connector's staging PUT command (the server
    hands back a presigned URL; the connector does the actual HTTP upload) — no separate
    Databricks Files API client/dependency needed. Overwrites any existing file at that path.

    The PUT statement's SQL parser treats backslashes inside a string literal as C-style escape
    sequences (e.g. "\\b" becomes a literal backspace character) — a real Windows path like
    "...\\brd_agent_suite\\output\\..." gets silently mangled into garbage if passed as-is.
    Forward slashes sidestep this entirely and Python's own file I/O accepts them on Windows just
    as well as backslashes, so the local path is normalized to forward slashes before being
    embedded in the statement (the destination Volume path is already forward-slash only)."""
    local = str(local_path).replace("\\", "/").replace("'", "''")
    dest = destination_volume_path.replace("'", "''")
    with _cursor() as cursor:
        cursor.execute(f"PUT '{local}' INTO '{dest}' OVERWRITE")


def download_from_volume(source_volume_path: str) -> bytes:
    """Downloads a file from the Volume via the connector's staging GET command and returns its
    raw bytes. GET only knows how to write its result to a local file (no in-memory form), so
    this uses a uniquely-named scratch file under _DOWNLOAD_SCRATCH_DIR and always removes it
    again before returning — including on error, so a failed download never leaves a stray file
    behind."""
    _DOWNLOAD_SCRATCH_DIR.mkdir(parents=True, exist_ok=True)
    scratch_path = _DOWNLOAD_SCRATCH_DIR / uuid.uuid4().hex
    source = source_volume_path.replace("'", "''")
    local = str(scratch_path).replace("\\", "/").replace("'", "''")
    try:
        with _cursor() as cursor:
            cursor.execute(f"GET '{source}' TO '{local}'")
        return scratch_path.read_bytes()
    finally:
        scratch_path.unlink(missing_ok=True)
