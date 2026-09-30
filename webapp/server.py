"""FastAPI backend for the Next.js frontend (frontend/). API-only — no static files served here;
the frontend (its own dev server or production build) proxies /api/* to this process.

Run from the project root (so `brd_agent_suite` and `webapp` both resolve as top-level packages):

    python -m uvicorn webapp.server:app --reload --port 8000
"""

from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

# Unlike `adk web`/`adk run`, a plain uvicorn process does not auto-load .env — do it before any
# brd_agent_suite import touches the Gemini client, or GOOGLE_API_KEY will be missing at request time.
#
# Note this only runs once per process: `uvicorn --reload` re-imports this module (and re-runs
# this line) on a *.py* change, but it does NOT watch .env — editing .env alone requires manually
# restarting the dev server, or the running worker keeps whatever key (or lack of one) it started
# with. The startup check below exists so that's visible in the console instead of silently
# surfacing as a "No API key was provided" error on the first /api/generate call.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

from brd_agent_suite.config import gemini_api_key_configured  # noqa: E402

print(f"Gemini API key configured: {gemini_api_key_configured()}")  # never logs the key itself

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import service
from .auth.dependencies import get_current_user
from .auth.router import router as auth_router
from .auth.schemas import UserPublic
from .projects.router import router as projects_router

app = FastAPI(title="BRD Agent Suite — API")
app.include_router(auth_router)
app.include_router(projects_router)


class GenerateRequest(BaseModel):
    form: dict[str, Any]
    auto_fields: list[str] = []
    excluded_sections: list[str] = []
    # If omitted, generate_from_form auto-creates a new project owned by current_user. If given,
    # ownership is re-verified server-side — this value is never trusted on its own.
    project_id: Optional[str] = None


class ReviseRequest(BaseModel):
    change_request: str


class DiagramsRequest(BaseModel):
    architecture: Optional[str] = None  # data:image/png;base64,...
    flowchart: Optional[str] = None


@app.get("/api/form-schema")
async def form_schema():
    """The field list the frontend renders — one source of truth instead of hardcoding it twice."""
    return {"fields": [{"name": name, "kind": kind} for name, kind in service.FORM_FIELDS]}


@app.post("/api/generate")
async def generate(req: GenerateRequest, current_user: UserPublic = Depends(get_current_user)):
    try:
        result = await service.generate_from_form(
            req.form, req.auto_fields, req.excluded_sections, current_user=current_user, project_id=req.project_id
        )
    except HTTPException:
        raise  # ownership/validation errors from service.py — surface as-is, don't mask as a 500
    except Exception as exc:  # noqa: BLE001 — surface pipeline failures to the UI, don't 500 silently
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return result


@app.post("/api/runs/{run_id}/revise")
async def revise(run_id: str, req: ReviseRequest, current_user: UserPublic = Depends(get_current_user)):
    try:
        result = await service.revise_run(run_id, req.change_request, current_user=current_user)
    except HTTPException:
        raise
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return result


# The routes below are plain `def`, not `async def`: their Databricks/filesystem calls are
# blocking, and FastAPI runs a `def` route in its threadpool — an `async def` one would stall the
# event loop (and with it every other in-flight request) for as long as its queries take.
@app.get("/api/runs")
def list_runs(current_user: UserPublic = Depends(get_current_user)):
    return {"runs": service.list_runs(current_user)}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str, current_user: UserPublic = Depends(get_current_user)):
    result = service.load_run(run_id, current_user)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return result


@app.post("/api/runs/{run_id}/diagrams")
def upload_diagrams(run_id: str, req: DiagramsRequest, current_user: UserPublic = Depends(get_current_user)):
    saved = []
    if req.architecture:
        service.save_diagram_png(run_id, "architecture", req.architecture, current_user)
        saved.append("architecture")
    if req.flowchart:
        service.save_diagram_png(run_id, "flowchart", req.flowchart, current_user)
        saved.append("flowchart")
    return {"saved": saved}


@app.post("/api/runs/{run_id}/export/{doc}")
def export_document(run_id: str, doc: str, current_user: UserPublic = Depends(get_current_user)):
    try:
        out_path = service.export_docx(run_id, doc, current_user)
    except HTTPException:
        raise
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — surface pandoc failures to the UI
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=out_path.name,
    )
