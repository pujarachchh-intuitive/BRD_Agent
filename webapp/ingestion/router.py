"""Routes for the document-upload flow, plus the job-polling endpoint both of its jobs use."""

from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel

from webapp import jobs
from webapp.auth.dependencies import get_current_user, get_session_user_id
from webapp.auth.schemas import UserPublic
from webapp.doc_templates.schemas import DomainChoice, TemplateUsage

from . import parsers
from . import service as ingestion_service

router = APIRouter(prefix="/api", tags=["documents"])

_READ_CHUNK_BYTES = 1024 * 1024


class GenerateFromExtractionRequest(BaseModel):
    form: dict[str, Any]
    auto_fields: list[str] = []
    excluded_sections: list[str] = []
    # Set when the user picked a template before uploading (see webapp/server.py GenerateRequest).
    template: Optional[TemplateUsage] = None
    domain: Optional[DomainChoice] = None


async def _read_capped(upload: UploadFile) -> bytes:
    """Reads an upload, refusing to go past the per-file limit instead of buffering a huge file."""
    chunks = []
    size = 0
    while chunk := await upload.read(_READ_CHUNK_BYTES):
        size += len(chunk)
        if size > parsers.MAX_FILE_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"{upload.filename}: the file is larger than {parsers.MAX_FILE_BYTES // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/documents/extract", status_code=status.HTTP_202_ACCEPTED)
async def extract_documents(
    files: list[UploadFile] = File(...),
    project_id: Optional[str] = Form(default=None),
    extraction_id: Optional[str] = Form(default=None),
    current_user: UserPublic = Depends(get_current_user),
):
    """Starts extracting a project from 1-5 uploaded documents. Returns a job to poll. Passing
    extraction_id adds these files to that earlier extraction's files and extracts again."""
    if len(files) > parsers.MAX_FILES:
        raise HTTPException(status_code=400, detail=f"You can upload at most {parsers.MAX_FILES} documents at once.")
    uploads = [(upload.filename or "document", await _read_capped(upload)) for upload in files]
    job = await ingestion_service.start_extraction(
        uploads, current_user=current_user, project_id=project_id, previous_extraction_id=extraction_id
    )
    return job.public()


# Plain `def`: blocking Databricks/Volume reads, run in FastAPI's threadpool (see server.py).
@router.get("/documents/extractions/{extraction_id}")
def get_extraction(extraction_id: str, current_user: UserPublic = Depends(get_current_user)):
    return ingestion_service.load_extraction(extraction_id, current_user)


@router.post("/documents/extractions/{extraction_id}/generate", status_code=status.HTTP_202_ACCEPTED)
async def generate_from_extraction(
    extraction_id: str,
    req: GenerateFromExtractionRequest,
    current_user: UserPublic = Depends(get_current_user),
):
    job = await ingestion_service.start_generation(
        extraction_id,
        req.form,
        req.auto_fields,
        req.excluded_sections,
        current_user=current_user,
        template=req.template,
        domain=req.domain,
    )
    return job.public()


@router.get("/jobs/{job_id}")
def get_job(job_id: str, user_id: str = Depends(get_session_user_id)):
    """Polled every few seconds, so it reads only process memory, never Databricks (see jobs.py)."""
    return jobs.get_job_for_user(job_id, user_id).public()
