"""POST /api/auth/register, /login, /logout and GET /api/auth/me."""

from typing import Optional

from fastapi import APIRouter, Cookie, Depends, Response, status

from . import repository, service
from .dependencies import get_current_user
from .schemas import LoginRequest, RegisterRequest, UserPublic
from .security import COOKIE_SECURE, SESSION_COOKIE_NAME, SESSION_TOKEN_TTL_SECONDS, decode_session_token

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=token,
        max_age=SESSION_TOKEN_TTL_SECONDS,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        path="/",
    )


# register/login/logout are plain `def` so FastAPI runs their blocking Databricks calls (and
# login's Argon2 hashing) in its threadpool instead of on the event loop — see webapp/server.py.
@router.post("/register", response_model=UserPublic, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest) -> UserPublic:
    return service.register_user(payload)


@router.post("/login", response_model=UserPublic)
def login(payload: LoginRequest, response: Response) -> UserPublic:
    user, token = service.authenticate_user(payload)
    _set_session_cookie(response, token)
    return user


@router.get("/me", response_model=UserPublic)
async def me(current_user: UserPublic = Depends(get_current_user)) -> UserPublic:
    return current_user


@router.post("/logout")
def logout(
    response: Response,
    session_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE_NAME),
) -> dict:
    # Best-effort audit entry — logging out with an already-expired/missing cookie still succeeds.
    user_id = decode_session_token(session_token) if session_token else None
    repository.insert_audit_log(user_id=user_id, action="USER_LOGOUT", entity_type="user", entity_id=user_id)
    response.delete_cookie(SESSION_COOKIE_NAME, path="/")
    return {"success": True}
