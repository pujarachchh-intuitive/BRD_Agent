"""Project CRUD plus the ownership check every other project/run/document-touching endpoint
calls through: `get_owned_project_or_404`. ADMIN bypasses the ownership check everywhere; a
normal USER only ever sees/touches rows where projects.user_id == current_user.user_id.
"""

from fastapi import HTTPException, status

from webapp import audit
from webapp.auth.schemas import UserPublic

from . import repository
from .schemas import ProjectCreateRequest, ProjectPublic, ProjectUpdateRequest


def create_project_row(current_user: UserPublic, project_name: str) -> dict:
    """Used both by POST /api/projects and by webapp/service.py's auto-create-on-generate path."""
    project = repository.create_project(user_id=current_user.user_id, project_name=project_name)
    audit.insert_audit_log(
        user_id=current_user.user_id, action="PROJECT_CREATED", entity_type="project", entity_id=project["project_id"]
    )
    return project


def create_project(current_user: UserPublic, payload: ProjectCreateRequest) -> ProjectPublic:
    return ProjectPublic.from_row(create_project_row(current_user, payload.project_name))


def list_projects(current_user: UserPublic) -> list[ProjectPublic]:
    rows = (
        repository.list_all_projects()
        if current_user.role == "ADMIN"
        else repository.list_projects_for_user(current_user.user_id)
    )
    return [ProjectPublic.from_row(row) for row in rows]


def get_owned_project_or_404(project_id: str, current_user: UserPublic) -> dict:
    """The ownership gate: ADMIN always passes; a USER only passes for their own project.

    Returns 404 (not 403) for "doesn't exist" AND "exists but isn't yours" — identical
    responses, so a caller can't use the status code to enumerate other users' project ids by
    probing for a 403-vs-404 difference.
    """
    project = repository.get_project_by_id(project_id)
    if project is None or (current_user.role != "ADMIN" and project["user_id"] != current_user.user_id):
        audit.insert_audit_log(
            user_id=current_user.user_id, action="ACCESS_DENIED", entity_type="project", entity_id=project_id
        )
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


def rename_project(project_id: str, payload: ProjectUpdateRequest, current_user: UserPublic) -> ProjectPublic:
    get_owned_project_or_404(project_id, current_user)
    repository.rename_project(project_id, payload.project_name)
    audit.insert_audit_log(
        user_id=current_user.user_id, action="PROJECT_UPDATED", entity_type="project", entity_id=project_id
    )
    return ProjectPublic.from_row(repository.get_project_by_id(project_id))
