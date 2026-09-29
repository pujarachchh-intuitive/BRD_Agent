"""Business logic for registration and login. Kept separate from router.py so the HTTP layer
stays thin, matching how webapp/service.py separates from webapp/server.py."""

from fastapi import HTTPException, status

from . import repository
from .schemas import LoginRequest, RegisterRequest, UserPublic
from .security import create_session_token, hash_password, verify_password


def normalize_email(email: str) -> str:
    return email.strip().lower()


def register_user(payload: RegisterRequest) -> UserPublic:
    email = normalize_email(payload.email)
    if repository.get_user_by_email(email) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists")

    password_hash = hash_password(payload.password)
    user = repository.create_user(
        name=payload.name,
        email=email,
        password_hash=password_hash,
        role="USER",
        status="ACTIVE",
    )
    repository.insert_audit_log(
        user_id=user["user_id"], action="USER_REGISTERED", entity_type="user", entity_id=user["user_id"]
    )
    return UserPublic.from_row(user)


def authenticate_user(payload: LoginRequest) -> tuple[UserPublic, str]:
    """Returns (public user, signed session token). Raises 401 for either an unknown email or a
    wrong password — deliberately the same error either way, so a login attempt can't be used to
    enumerate registered accounts."""
    email = normalize_email(payload.email)
    user = repository.get_user_by_email(email)
    if user is None or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if user["status"] != "ACTIVE":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This account is inactive")

    repository.update_last_login(user["user_id"])
    repository.insert_audit_log(
        user_id=user["user_id"], action="USER_LOGIN", entity_type="user", entity_id=user["user_id"]
    )
    token = create_session_token(user["user_id"])
    return UserPublic.from_row(user), token
