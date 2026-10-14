"""Fills the Date and Author rows of a generated document's document-control table (the table at
the top of the BRD and TSD) with when the run was generated and who generated it.

The generator prompts leave these as "[Date]" / "[Author]" placeholders: the model doesn't know
either fact, so anything it wrote there would be invented. They're filled in here instead, from the
run itself — right after generation, and again whenever a run is opened or exported, so documents
generated before this existed get filled in too (filling is idempotent).
"""

import os
import re
from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# The documents' readers are in India; the server runs on UTC. Overridable per deployment.
DOCUMENT_TIMEZONE = os.environ.get("DOCUMENT_TIMEZONE", "Asia/Kolkata")

# The documents that carry a document-control table (state key -> file name).
CONTROLLED_DOCUMENTS = {"brd_markdown": "BRD.md", "tsd_markdown": "TSD.md"}

# A table row whose first cell is "Date" or "Author", optionally bold: "| **Date** | [Date] |".
_ROW = re.compile(r"^(\s*\|\s*)(\*\*)?(Date|Author)(\*\*)?(\s*\|)[^|\n]*(\|.*)$")
_RUN_ID_TIMESTAMP = re.compile(r"^(?:[a-z]+-)?(\d{8}-\d{6})")


def run_created_at(run_id: str) -> Optional[datetime]:
    """When a run was generated: run ids start with its UTC start time (tools.new_run_id)."""
    match = _RUN_ID_TIMESTAMP.match(run_id)
    if not match:
        return None
    return datetime.strptime(match.group(1), "%Y%m%d-%H%M%S").replace(tzinfo=timezone.utc)


def format_document_date(moment: datetime) -> str:
    """e.g. "9 October 2026", in DOCUMENT_TIMEZONE (UTC if that zone isn't known here)."""
    try:
        moment = moment.astimezone(ZoneInfo(DOCUMENT_TIMEZONE))
    except ZoneInfoNotFoundError:
        moment = moment.astimezone(timezone.utc)
    return f"{moment.day} {moment:%B %Y}"


def _first_table_rows(markdown: str):
    """(line index, row match) for each Date/Author row in the document's first table."""
    lines = markdown.split("\n")
    in_table = False
    for i, line in enumerate(lines):
        if line.lstrip().startswith("|"):
            in_table = True
        elif in_table:
            return
        else:
            continue
        match = _ROW.match(line)
        if match:
            yield i, match


def has_document_control(markdown: Optional[str]) -> bool:
    return bool(markdown) and any(True for _ in _first_table_rows(markdown))


def fill_document_control(markdown: str, *, date: Optional[str], author: Optional[str]) -> str:
    """Sets the value cell of the Date and Author rows in the document's first table (its
    document-control table), keeping the row's own formatting. A value that isn't known (None)
    leaves that row as it is."""
    values = {"Date": date, "Author": author}
    lines = markdown.split("\n")
    for i, match in list(_first_table_rows(markdown)):
        if values[match.group(3)] is None:
            continue
        value = values[match.group(3)].replace("|", "\\|").strip()
        lead, bold_open, field, bold_close, sep, rest = match.groups()
        lines[i] = f"{lead}{bold_open or ''}{field}{bold_close or ''}{sep} {value} {rest}"
    return "\n".join(lines)
