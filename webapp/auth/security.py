"""Password hashing (Argon2id) and session-token (JWT) signing/verification.

No existing password-hashing or token dependency was in the project, so this picks the current
recommended defaults: argon2-cffi (Argon2id, OWASP's first choice) for passwords, and joserfc
(already an installed transitive dependency, actively maintained) for signing a compact JWT
carried in an HTTP-only cookie.
"""

import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHash, VerifyMismatchError
from joserfc import jwt
from joserfc.jwk import OctKey

SESSION_COOKIE_NAME = "brd_session"
_ALGORITHM = "HS256"
SESSION_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7  # 7 days

# Cookies can only carry the Secure flag over HTTPS — the dev setup (Next.js + uvicorn on plain
# HTTP on localhost) would otherwise have the browser silently drop the session cookie.
COOKIE_SECURE = os.getenv("APP_ENV", "development") not in ("development", "test")

_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except (VerifyMismatchError, InvalidHash):
        return False


def _secret_key() -> OctKey:
    secret = os.getenv("AUTH_SECRET")
    if not secret:
        raise RuntimeError("AUTH_SECRET environment variable is not set — see .env.example")
    return OctKey.import_key(secret)


def create_session_token(user_id: str) -> str:
    now = datetime.now(timezone.utc)
    claims = {
        "sub": user_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(seconds=SESSION_TOKEN_TTL_SECONDS)).timestamp()),
    }
    return jwt.encode({"alg": _ALGORITHM}, claims, _secret_key())


def decode_session_token(token: str) -> Optional[str]:
    """Returns the user_id (the token's `sub` claim), or None if the token is missing, malformed,
    signed with a different secret, or expired."""
    try:
        decoded = jwt.decode(token, _secret_key(), algorithms=[_ALGORITHM])
    except Exception:
        return None
    exp = decoded.claims.get("exp")
    if exp is None or datetime.now(timezone.utc).timestamp() > exp:
        return None
    return decoded.claims.get("sub")
