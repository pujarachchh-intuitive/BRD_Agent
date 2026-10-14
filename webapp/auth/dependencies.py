"""Reusable FastAPI dependencies for routes that need the current user. Not yet applied to the
existing BRD generation routes — that's ownership enforcement, a later step."""

from typing import Optional

from fastapi import Cookie, Depends, HTTPException, status

from . import repository
from .schemas import UserPublic
from .security import SESSION_COOKIE_NAME, decode_session_token


def get_current_user(
    session_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> UserPublic:
    unauthenticated = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    if not session_token:
        raise unauthenticated
    user_id = decode_session_token(session_token)
    if not user_id:
        raise unauthenticated
    user = repository.get_user_by_id(user_id)
    if not user or user["status"] != "ACTIVE":
        raise unauthenticated
    return UserPublic.from_row(user)


def get_session_user_id(
    session_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> str:
    """The signed-in user's id from the session token alone, with no Databricks lookup. Only for
    endpoints polled every few seconds (GET /api/jobs/{id}), where a query per poll would keep the
    SQL warehouse from ever auto-stopping. Unlike get_current_user, it doesn't notice a user
    deactivated since signing in, so it must only guard data that user already owns."""
    user_id = decode_session_token(session_token) if session_token else None
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return user_id


def require_admin(current_user: UserPublic = Depends(get_current_user)) -> UserPublic:
    if current_user.role != "ADMIN":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return current_user
