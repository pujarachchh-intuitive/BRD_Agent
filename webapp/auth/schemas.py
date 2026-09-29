"""Request/response models for the auth endpoints. Registration deliberately has no role/status/
user_id fields — those are always server-assigned (role=USER, status=ACTIVE), so a caller has no
way to request otherwise."""

from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    name: str
    email: EmailStr
    password: str

    @field_validator("name")
    @classmethod
    def _name_not_blank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < 2:
            raise ValueError("name must be at least 2 characters")
        return value

    @field_validator("password")
    @classmethod
    def _password_strength(cls, value: str) -> str:
        if len(value) < 8:
            raise ValueError("password must be at least 8 characters")
        return value


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserPublic(BaseModel):
    user_id: str
    name: str
    email: str
    role: str
    status: str

    @staticmethod
    def from_row(row: dict) -> "UserPublic":
        """row is a users-table dict (or subset) that may include password_hash — never passed
        through since UserPublic only declares the safe fields."""
        return UserPublic(
            user_id=row["user_id"],
            name=row["name"],
            email=row["email"],
            role=row["role"],
            status=row["status"],
        )
