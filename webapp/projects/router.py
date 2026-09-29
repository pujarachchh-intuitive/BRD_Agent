"""POST/GET /api/projects, GET/PATCH /api/projects/{project_id}."""

from fastapi import APIRouter, Depends, status

from webapp.auth.dependencies import get_current_user
from webapp.auth.schemas import UserPublic

from . import service
from .schemas import ProjectCreateRequest, ProjectPublic, ProjectUpdateRequest

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.post("", response_model=ProjectPublic, status_code=status.HTTP_201_CREATED)
async def create_project(payload: ProjectCreateRequest, current_user: UserPublic = Depends(get_current_user)) -> ProjectPublic:
    return service.create_project(current_user, payload)


@router.get("", response_model=list[ProjectPublic])
async def list_projects(current_user: UserPublic = Depends(get_current_user)) -> list[ProjectPublic]:
    return service.list_projects(current_user)


@router.get("/{project_id}", response_model=ProjectPublic)
async def get_project(project_id: str, current_user: UserPublic = Depends(get_current_user)) -> ProjectPublic:
    return ProjectPublic.from_row(service.get_owned_project_or_404(project_id, current_user))


@router.patch("/{project_id}", response_model=ProjectPublic)
async def update_project(
    project_id: str, payload: ProjectUpdateRequest, current_user: UserPublic = Depends(get_current_user)
) -> ProjectPublic:
    return service.rename_project(project_id, payload, current_user)
