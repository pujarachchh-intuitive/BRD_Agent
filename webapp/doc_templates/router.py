"""GET /api/templates, /api/templates/{id}, /api/domains for every signed-in user, and the
admin-only Template Studio API under /api/admin. There are no DELETE routes: templates are
retired and domains deactivated instead, both reversibly."""

from fastapi import APIRouter, Depends

from webapp.auth.dependencies import get_current_user, require_admin
from webapp.auth.schemas import UserPublic

from . import service
from .schemas import (
    ICONS,
    SEEDABLE_FIELDS,
    DomainCreateRequest,
    DomainUpdateRequest,
    DraftSaveRequest,
    PublishRequest,
    TemplateCreateRequest,
    TemplateUpdateRequest,
)

router = APIRouter(prefix="/api", tags=["templates"])
admin_router = APIRouter(prefix="/api/admin", tags=["templates-admin"])

# Plain `def` routes: FastAPI runs their blocking Databricks calls in its threadpool instead of on
# the event loop — see webapp/server.py.


@router.get("/templates")
def list_templates(current_user: UserPublic = Depends(get_current_user)):
    return {"templates": service.list_published_templates()}


@router.get("/templates/{template_id}")
def get_template(template_id: str, current_user: UserPublic = Depends(get_current_user)):
    return service.get_published_template(template_id)


@router.get("/domains")
def list_domains(current_user: UserPublic = Depends(get_current_user)):
    return {"domains": service.list_domains()}


# ---------- Admin ----------


@admin_router.get("/templates/schema")
def template_schema(admin: UserPublic = Depends(require_admin)):
    """Which form fields a template may pre-fill (and their item value names), and the icons."""
    return {"fields": SEEDABLE_FIELDS, "icons": list(ICONS)}


@admin_router.get("/templates")
def admin_list_templates(admin: UserPublic = Depends(require_admin)):
    return {"templates": service.admin_list_templates()}


@admin_router.post("/templates", status_code=201)
def create_template(payload: TemplateCreateRequest, admin: UserPublic = Depends(require_admin)):
    return service.create_template(admin, payload)


@admin_router.get("/templates/{template_id}")
def admin_get_template(template_id: str, admin: UserPublic = Depends(require_admin)):
    return service.admin_get_template(template_id)


@admin_router.put("/templates/{template_id}")
def update_template(template_id: str, payload: TemplateUpdateRequest, admin: UserPublic = Depends(require_admin)):
    return service.update_template(admin, template_id, payload)


@admin_router.put("/templates/{template_id}/draft")
def save_draft(template_id: str, payload: DraftSaveRequest, admin: UserPublic = Depends(require_admin)):
    return service.save_draft(admin, template_id, payload)


@admin_router.post("/templates/{template_id}/publish")
def publish(template_id: str, payload: PublishRequest, admin: UserPublic = Depends(require_admin)):
    return service.publish(admin, template_id, payload)


@admin_router.get("/templates/{template_id}/versions/{version}")
def get_version(template_id: str, version: int, admin: UserPublic = Depends(require_admin)):
    return service.admin_get_version(template_id, version)


@admin_router.post("/templates/{template_id}/versions/{version}/restore")
def restore_version(template_id: str, version: int, admin: UserPublic = Depends(require_admin)):
    return service.restore_version(admin, template_id, version)


@admin_router.post("/templates/{template_id}/retire")
def retire(template_id: str, admin: UserPublic = Depends(require_admin)):
    return service.set_status(admin, template_id, "RETIRED")


@admin_router.post("/templates/{template_id}/reactivate")
def reactivate(template_id: str, admin: UserPublic = Depends(require_admin)):
    return service.set_status(admin, template_id, "ACTIVE")


@admin_router.get("/domains")
def admin_list_domains(admin: UserPublic = Depends(require_admin)):
    return {"domains": service.admin_list_domains()}


@admin_router.post("/domains", status_code=201)
def create_domain(payload: DomainCreateRequest, admin: UserPublic = Depends(require_admin)):
    return service.create_domain(admin, payload)


@admin_router.patch("/domains/{domain_id}")
def update_domain(domain_id: str, payload: DomainUpdateRequest, admin: UserPublic = Depends(require_admin)):
    return service.update_domain(admin, domain_id, payload)
