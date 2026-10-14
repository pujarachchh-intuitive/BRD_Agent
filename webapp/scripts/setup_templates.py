"""One-time (re-runnable) setup for domain templates: creates the three template tables, adds the
starter domain list, and loads the starter templates as unpublished drafts.

Run from the project root:

    python -m webapp.scripts.setup_templates            # dry run: prints what it would do
    python -m webapp.scripts.setup_templates --apply    # does it

Only ever adds things. Tables are created with IF NOT EXISTS; a domain or template that already
exists (by id / slug) is skipped, never updated — so re-running it after admins have edited
anything in Template Studio leaves their work exactly as it is. No row is deleted or changed.

Starter templates go in as DRAFTs: an admin reviews each item (every one lists its source) in
Template Studio and publishes it before any user sees it.
"""

import argparse
import json
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parents[2] / ".env")

from webapp.db import execute  # noqa: E402
from webapp.doc_templates import repository  # noqa: E402
from webapp.doc_templates.schemas import TemplateContent, TemplateCreateRequest  # noqa: E402

STARTER_DIR = Path(__file__).resolve().parents[1] / "doc_templates" / "starter"
SYSTEM_USER = "system:setup_templates"

# (domain_id, name) in dropdown order. Admins can rename, reorder, hide or add to these later.
STARTER_DOMAINS = [
    ("healthcare", "Healthcare"),
    ("financial_services", "Financial Services"),
    ("insurance", "Insurance"),
    ("life_sciences", "Life Sciences & Pharma"),
    ("public_sector", "Public Sector & Government"),
    ("retail_ecommerce", "Retail & E-commerce"),
    ("education", "Education"),
    ("manufacturing", "Manufacturing & Industrial"),
    ("telecom", "Telecommunications"),
    ("energy_utilities", "Energy & Utilities"),
    ("logistics", "Transportation & Logistics"),
    ("media_entertainment", "Media & Entertainment"),
    ("hospitality", "Hospitality & Travel"),
    ("real_estate", "Real Estate & Construction"),
    ("technology_saas", "Technology & SaaS"),
]


def load_starter_templates() -> list[TemplateCreateRequest]:
    """Every starter JSON file, fully validated — an invalid file aborts the run before any write."""
    templates = []
    for path in sorted(STARTER_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        data["content"] = TemplateContent.model_validate(data["content"])
        templates.append(TemplateCreateRequest.model_validate(data))
    return templates


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true", help="actually make the changes (default: dry run)")
    args = parser.parse_args()
    apply = args.apply
    prefix = "" if apply else "[dry run] would "

    try:
        starters = load_starter_templates()
    except Exception as exc:  # noqa: BLE001 — report and stop before touching the warehouse
        print(f"A starter template file is invalid, nothing was changed: {exc}")
        return 1

    for statement in repository.CREATE_TABLE_STATEMENTS:
        table = statement.split("EXISTS", 1)[1].split("(", 1)[0].strip()
        print(f"{prefix}create table if missing: {table}")
        if apply:
            execute(statement)

    # Reading the existing rows needs the tables; on a dry run against a fresh warehouse they may
    # not exist yet, in which case everything below would be added.
    try:
        existing_domains = {d["domain_id"] for d in repository.list_domains()}
    except Exception:  # noqa: BLE001
        existing_domains = set()
    for order, (domain_id, name) in enumerate(STARTER_DOMAINS, start=1):
        if domain_id in existing_domains:
            print(f"skip domain (already exists): {domain_id}")
            continue
        print(f"{prefix}add domain: {domain_id} ({name})")
        if apply:
            repository.insert_domain(domain_id=domain_id, name=name, sort_order=order * 10, created_by=SYSTEM_USER)

    for starter in starters:
        try:
            exists = repository.get_template_by_slug(starter.slug) is not None
        except Exception:  # noqa: BLE001
            exists = False
        if exists:
            print(f"skip template (already exists): {starter.slug}")
            continue
        item_count = sum(len(items) for items in starter.content.items.values())
        print(f"{prefix}add template as an unpublished draft: {starter.slug} ({item_count} items)")
        if apply:
            row = repository.insert_template(
                slug=starter.slug,
                name=starter.name,
                domain_id=starter.domain_id,
                description=starter.description,
                icon=starter.icon,
                color=starter.color,
                created_by=SYSTEM_USER,
            )
            repository.insert_version(
                template_id=row["template_id"],
                version=1,
                content=json.dumps(starter.content.model_dump(mode="json"), ensure_ascii=False),
                change_note="Starter content — review each item and its source before publishing",
                created_by=SYSTEM_USER,
            )

    if not apply:
        print("\nDry run only. Re-run with --apply to make these changes.")
    else:
        print("\nDone. Open Template Studio, review the starter drafts, and publish them.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
