from pydantic import BaseModel, field_validator


class ProjectCreateRequest(BaseModel):
    """No user_id/is_legacy/status field here on purpose — those are always server-assigned
    (current_user.user_id, is_legacy=False), so a caller has no way to request otherwise. Any
    extra fields a caller sends (e.g. a spoofed "user_id") are silently ignored by pydantic."""

    project_name: str

    @field_validator("project_name")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("project_name must not be blank")
        return value


class ProjectUpdateRequest(BaseModel):
    project_name: str

    @field_validator("project_name")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("project_name must not be blank")
        return value


class ProjectPublic(BaseModel):
    project_id: str
    user_id: str
    project_name: str
    status: str
    is_legacy: bool
    created_at: str
    updated_at: str

    @staticmethod
    def from_row(row: dict) -> "ProjectPublic":
        return ProjectPublic(
            **{
                k: row[k]
                for k in ("project_id", "user_id", "project_name", "status", "is_legacy", "created_at", "updated_at")
            }
        )
