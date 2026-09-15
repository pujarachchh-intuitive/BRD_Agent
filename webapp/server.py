"""FastAPI backend for the structured-form UI.

Run from the project root (so `brd_agent_suite` and `webapp` both resolve as top-level packages):

    python -m uvicorn webapp.server:app --reload --port 8000

Then open http://127.0.0.1:8000/ in a browser.
"""

from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv

# Unlike `adk web`/`adk run`, a plain uvicorn process does not auto-load .env — do it before any
# brd_agent_suite import touches the Gemini client, or GOOGLE_API_KEY will be missing at request time.
load_dotenv(dotenv_path=Path(__file__).resolve().parent.parent / ".env")

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import service

app = FastAPI(title="BRD Agent Suite — Form UI")

STATIC_DIR = Path(__file__).resolve().parent / "static"


class GenerateRequest(BaseModel):
    form: dict[str, Any]
    auto_fields: list[str] = []
    excluded_sections: list[str] = []


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
async def generate(req: GenerateRequest):
    try:
        result = await service.generate_from_form(req.form, req.auto_fields, req.excluded_sections)
    except Exception as exc:  # noqa: BLE001 — surface pipeline failures to the UI, don't 500 silently
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return result


@app.post("/api/runs/{run_id}/revise")
async def revise(run_id: str, req: ReviseRequest):
    try:
        result = await service.revise_run(run_id, req.change_request)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return result


@app.get("/api/runs")
async def list_runs():
    return {"runs": service.list_runs()}


@app.get("/api/runs/{run_id}")
async def get_run(run_id: str):
    result = service.load_run(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"Run {run_id} not found")
    return result


@app.post("/api/runs/{run_id}/diagrams")
async def upload_diagrams(run_id: str, req: DiagramsRequest):
    saved = []
    if req.architecture:
        service.save_diagram_png(run_id, "architecture", req.architecture)
        saved.append("architecture")
    if req.flowchart:
        service.save_diagram_png(run_id, "flowchart", req.flowchart)
        saved.append("flowchart")
    return {"saved": saved}


@app.post("/api/runs/{run_id}/export/{doc}")
async def export_document(run_id: str, doc: str):
    try:
        out_path = service.export_docx(run_id, doc)
    except (FileNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 — surface pandoc failures to the UI
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return FileResponse(
        out_path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=out_path.name,
    )


# Static frontend last, so /api/* above takes priority over the catch-all.
app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")
