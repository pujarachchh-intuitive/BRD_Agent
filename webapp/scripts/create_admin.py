"""One-time bootstrap for creating the first Admin user.

Run from the project root:

    python -m webapp.scripts.create_admin

Reads ADMIN_NAME / ADMIN_EMAIL / ADMIN_PASSWORD from the environment when set; otherwise prompts
interactively (the password prompt does not echo input). Refuses to run if an active Admin
already exists, so it can never create a duplicate — run it again with different env vars/answers
if you need a second Admin account later, that check only blocks a *duplicate* first bootstrap.
"""

import getpass
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(dotenv_path=Path(__file__).resolve().parents[2] / ".env")

from webapp.auth import repository  # noqa: E402
from webapp.auth.security import hash_password  # noqa: E402


def _prompt_name() -> str:
    while True:
        name = input("Admin name: ").strip()
        if len(name) >= 2:
            return name
        print("Name must be at least 2 characters.")


def _prompt_email() -> str:
    while True:
        email = input("Admin email: ").strip().lower()
        local, _, domain = email.partition("@")
        if local and "." in domain:
            return email
        print("Enter a valid email address.")


def _prompt_password() -> str:
    while True:
        password = getpass.getpass("Admin password (min 8 characters): ")
        if len(password) < 8:
            print("Password must be at least 8 characters.")
            continue
        if password != getpass.getpass("Confirm password: "):
            print("Passwords do not match.")
            continue
        return password


def main() -> int:
    existing_admin = repository.get_active_admin()
    if existing_admin is not None:
        print(f"An active Admin already exists ({existing_admin['email']}). Aborting.")
        return 1

    name = os.getenv("ADMIN_NAME") or _prompt_name()
    email = (os.getenv("ADMIN_EMAIL") or _prompt_email()).strip().lower()
    password = os.getenv("ADMIN_PASSWORD") or _prompt_password()

    if len(password) < 8:
        print("ADMIN_PASSWORD must be at least 8 characters.")
        return 1
    if repository.get_user_by_email(email) is not None:
        print(f"A user with email {email} already exists. Aborting.")
        return 1

    user = repository.create_user(
        name=name, email=email, password_hash=hash_password(password), role="ADMIN", status="ACTIVE"
    )
    repository.insert_audit_log(
        user_id=user["user_id"], action="ADMIN_CREATED", entity_type="user", entity_id=user["user_id"]
    )
    print(f"Admin created: {user['email']} (user_id={user['user_id']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
