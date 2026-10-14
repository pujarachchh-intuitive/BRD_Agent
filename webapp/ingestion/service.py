"""The document-upload flow: upload -> parse -> extract -> review -> generate.

1. start_extraction: validates and parses the uploaded files (locally, free), then starts a
   background job that runs document_extraction_agent over them, verifies the evidence, stores
   everything under the project, and returns the review payload (form + per-field review states +
   questions for the gaps).
2. The user reviews that payload in the UI and fills in anything blocking.
3. start_generation: runs the existing form pipeline on the reviewed form, with the uploaded
   documents' text as extra grounding for the fields left to the AI.

An extraction is identified by an extraction_id ("ext-<run id>"). It gets its own generation_runs
row (generation_type "document_extraction"), which is what records its cost and owner, so every
extraction endpoint authorizes through the same _authorize_run_access as a run. Its files are
`documents` rows tagged with the extraction_id in run_id, so they're fetched back like a run's.
"""

import asyncio
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException, status
from google.genai import types

from brd_agent_suite.config import MODEL_NAME, PROVIDER_NAME
from brd_agent_suite.field_guide import FIELD_GUIDE_BY_NAME
from brd_agent_suite.sub_agents.document_extraction_agent import (
    build_document_extraction_agent,
    build_extraction_merge_agent,
)
from brd_agent_suite.tools import new_run_id, run_agent_to_state
from webapp import audit, documents_repository, jobs, runs_repository
from webapp import service as core
from webapp.auth.schemas import UserPublic
from webapp.doc_templates import service as templates_service
from webapp.doc_templates.schemas import DomainChoice, TemplateUsage
from webapp.projects import repository as projects_repository
from webapp.projects import service as projects_service

from . import parsers, verify
from .parsers import ParsedDocument, UploadRejected

EXTRACTION_PREFIX = "ext-"
EXTRACTION_FILE = "extraction.json"

# Above this many (estimated) tokens in total, each document is extracted on its own and the
# results merged, instead of one combined call. Gemini Flash can take far more, but cost and
# answer quality both degrade on very long single prompts.
SINGLE_CALL_TOKEN_BUDGET = 150_000
# Gemini's limit for files sent inline in one request is about 20 MB.
MAX_INLINE_PDF_BYTES = 18 * 1024 * 1024
# How much of the documents' raw text the gap-filler gets as grounding at generation time.
SOURCE_CONTEXT_MAX_CHARS = 120_000

MAX_RUNNING_JOBS_PER_USER = 2
upload_limiter = jobs.RateLimiter(limit=int(os.getenv("DOC_UPLOADS_PER_DAY", "10")), window_seconds=24 * 60 * 60)

# (user_id, sorted file hashes) -> extraction_id. Uploading the exact same files again reuses
# that extraction instead of paying for a second LLM call. In memory only: it's an optimization,
# so losing it on restart costs nothing but one repeat call.
_extraction_cache: dict[tuple[str, tuple[str, ...]], str] = {}

# Agent name -> progress message shown while generating.
_AGENT_PROGRESS = {
    "gap_filler_agent": "Requirements finalized",
    "brd_agent": "BRD drafted",
    "tsd_agent": "TSD drafted",
    "flowchart_agent": "Process flowchart drawn",
    "architecture_agent": "Architecture diagram drawn",
    "onepager_agent": "Executive one-pager written",
    "consistency_check_agent": "Consistency check complete",
}


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def _extraction_dir(extraction_id: str) -> Path:
    # Looked up on the module at call time so tests can point OUTPUT_ROOT at a scratch directory.
    return core.OUTPUT_ROOT / extraction_id


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _check_job_limits(current_user: UserPublic) -> None:
    if jobs.running_jobs_for(current_user.user_id) >= MAX_RUNNING_JOBS_PER_USER:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="You already have documents being processed. Please wait for them to finish.",
        )


# ---------------------------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------------------------


def _parse_uploads(uploads: list[tuple[str, bytes]]) -> list[ParsedDocument]:
    docs: list[ParsedDocument] = []
    for original_name, data in uploads:
        try:
            docs.append(parsers.parse_document(parsers.safe_file_name(original_name), data))
        except UploadRejected as exc:
            raise _bad_request(str(exc)) from exc
    return docs


def _dedupe_and_name(docs: list[ParsedDocument]) -> list[ParsedDocument]:
    """Drops exact duplicate files and makes every file name unique, since file names are how
    evidence is matched back to a document."""
    unique: list[ParsedDocument] = []
    seen_hashes: set[str] = set()
    seen_names: set[str] = set()
    for doc in docs:
        if doc.sha256 in seen_hashes:
            continue
        seen_hashes.add(doc.sha256)
        name, n = doc.file_name, 2
        stem, dot, ext = doc.file_name.rpartition(".")
        while name.lower() in seen_names:
            name = f"{stem}_{n}.{ext}" if dot else f"{doc.file_name}_{n}"
            n += 1
        seen_names.add(name.lower())
        doc.file_name = name
        unique.append(doc)
    return unique


async def start_extraction(
    uploads: list[tuple[str, bytes]],
    *,
    current_user: UserPublic,
    project_id: Optional[str] = None,
    previous_extraction_id: Optional[str] = None,
) -> jobs.Job:
    """Validates and parses synchronously, so a bad file is rejected right away with a clear
    message, then runs the (slow, paid) extraction as a background job.

    previous_extraction_id adds the new files to an earlier extraction's files and re-extracts
    from all of them together (the review page's "Add another document")."""
    if not uploads:
        raise _bad_request("Choose at least one document to upload.")

    project: Optional[dict] = None
    previous_docs: list[ParsedDocument] = []
    if previous_extraction_id:
        previous = await asyncio.to_thread(load_extraction, previous_extraction_id, current_user)
        project = await asyncio.to_thread(projects_service.get_owned_project_or_404, previous["project_id"], current_user)
        previous_docs = await asyncio.to_thread(_load_parsed_documents, previous_extraction_id, previous)
    elif project_id:
        project = await asyncio.to_thread(projects_service.get_owned_project_or_404, project_id, current_user)

    if len(previous_docs) + len(uploads) > parsers.MAX_FILES:
        raise _bad_request(f"You can upload at most {parsers.MAX_FILES} documents per project extraction.")
    total_bytes = sum(len(data) for _, data in uploads) + sum(d.size_bytes for d in previous_docs)
    if total_bytes > parsers.MAX_TOTAL_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"The documents add up to more than {parsers.MAX_TOTAL_BYTES // (1024 * 1024)} MB in total.",
        )

    new_docs = await asyncio.to_thread(_parse_uploads, uploads)
    docs = _dedupe_and_name(previous_docs + new_docs)

    cache_key = (current_user.user_id, tuple(sorted(d.sha256 for d in docs)))
    cached = _cached_payload(cache_key)
    if cached is not None:
        job = jobs.create_job(current_user.user_id, "document_extraction")
        job.add_progress("These exact documents were already read, so the earlier extraction was reused.")
        job.succeed(cached)
        return job

    _check_job_limits(current_user)
    if current_user.role != "ADMIN":
        upload_limiter.check(current_user.user_id)

    job = jobs.create_job(current_user.user_id, "document_extraction", stage="Extracting project information")
    extraction_id = f"{EXTRACTION_PREFIX}{new_run_id()}"
    pages = sum(d.page_count or 0 for d in docs)
    job.add_progress(
        f"Read {len(docs)} document{'s' if len(docs) != 1 else ''}"
        + (f" ({pages} PDF pages)" if pages else "")
        + "."
    )

    async def work(job: jobs.Job) -> dict:
        payload = await _run_extraction_job(job, extraction_id, docs, project, current_user)
        _extraction_cache[cache_key] = extraction_id
        return payload

    await jobs.launch(job, work)
    return job


def _cached_payload(cache_key: tuple[str, tuple[str, ...]]) -> Optional[dict]:
    extraction_id = _extraction_cache.get(cache_key)
    if extraction_id is None:
        return None
    path = _extraction_dir(extraction_id) / EXTRACTION_FILE
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _extraction_cache.pop(cache_key, None)
        return None


async def _run_extraction_job(
    job: jobs.Job,
    extraction_id: str,
    docs: list[ParsedDocument],
    project: Optional[dict],
    current_user: UserPublic,
) -> dict:
    started = asyncio.get_running_loop().time()
    job.set_stage("Extracting project information")
    extraction, mode = await _extract(docs, extraction_id, job)

    job.set_stage("Checking the evidence")
    review = verify.build_review(extraction, {d.file_name: (None if d.needs_native else d.text) for d in docs})

    job.set_stage("Saving")
    project_created = False
    if project is None:
        name = (review["form"].get("project_name") or "").strip() or Path(docs[0].file_name).stem
        project = await asyncio.to_thread(projects_service.create_project_row, current_user, name)
        project_created = True

    files = [_file_entry(i, d) for i, d in enumerate(docs, start=1)]
    payload = {
        "extraction_id": extraction_id,
        "project_id": project["project_id"],
        "project_name": project["project_name"],
        "project_created": project_created,
        "created_at": _now_iso(),
        "mode": mode,
        "files": files,
        **review,
    }
    await asyncio.to_thread(
        _persist_extraction,
        extraction_id,
        project,
        docs,
        files,
        payload,
        current_user,
        int((asyncio.get_running_loop().time() - started) * 1000),
    )
    job.add_progress(
        f"Found {sum(1 for f in review['fields'] if f['state'] == 'found')} fields with clear evidence; "
        f"{len(review['blocking'])} need your input."
    )
    return payload


def _file_entry(index: int, doc: ParsedDocument) -> dict:
    stored_name = f"{index:02d}_{doc.file_name}"
    return {
        "file_name": doc.file_name,
        "stored_name": stored_name,
        "text_name": None if doc.needs_native else f"{stored_name}.extracted.md",
        "kind": doc.kind,
        "page_count": doc.page_count,
        "size_bytes": doc.size_bytes,
        "scanned": doc.needs_native,
        "sha256": doc.sha256,
        "estimated_tokens": doc.estimated_tokens,
    }


def _persist_extraction(
    extraction_id: str,
    project: dict,
    docs: list[ParsedDocument],
    files: list[dict],
    payload: dict,
    current_user: UserPublic,
    latency_ms: int,
) -> None:
    """Writes every artifact to the extraction's local working folder, uploads it to the Volume,
    and records the extraction's cost/ownership row. Blocking: call in a thread."""
    folder = _extraction_dir(extraction_id)
    folder.mkdir(parents=True, exist_ok=True)
    project_id = project["project_id"]

    for doc, entry in zip(docs, files):
        source_path = folder / entry["stored_name"]
        source_path.write_bytes(doc.raw)
        documents_repository.upload_document_version(
            project_id=project_id,
            document_type=documents_repository.SOURCE_DOCUMENT,
            local_path=source_path,
            run_id=extraction_id,
        )
        if entry["text_name"]:
            text_path = folder / entry["text_name"]
            text_path.write_text(doc.text, encoding="utf-8")
            documents_repository.upload_document_version(
                project_id=project_id,
                document_type=documents_repository.SOURCE_TEXT,
                local_path=text_path,
                run_id=extraction_id,
            )

    payload_path = folder / EXTRACTION_FILE
    payload_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    documents_repository.upload_document_version(
        project_id=project_id,
        document_type=documents_repository.SOURCE_EXTRACTION,
        local_path=payload_path,
        run_id=extraction_id,
    )

    log_stats = core.aggregate_run_log(extraction_id)
    runs_repository.insert_generation_run(
        run_id=extraction_id,
        user_id=current_user.user_id,
        project_id=project_id,
        generation_type="document_extraction",
        status="success",
        agent_id="document_extraction_agent",
        provider=log_stats["provider"] or PROVIDER_NAME,
        model=log_stats["model"] or MODEL_NAME,
        input_tokens=log_stats["input_tokens"],
        output_tokens=log_stats["output_tokens"],
        total_tokens=log_stats["total_tokens"],
        latency_ms=latency_ms,
        metadata={
            "mode": payload["mode"],
            "files": [{"file_name": f["file_name"], "kind": f["kind"], "scanned": f["scanned"]} for f in files],
            "blocking": payload["blocking"],
            "cost_by_agent": log_stats["cost_by_agent"],
        },
    )
    audit.insert_audit_log(
        user_id=current_user.user_id,
        action="SOURCE_UPLOADED",
        entity_type="project",
        entity_id=project_id,
        metadata={"extraction_id": extraction_id, "files": [f["file_name"] for f in files]},
    )
    audit.insert_audit_log(
        user_id=current_user.user_id,
        action="EXTRACTION_COMPLETED",
        entity_type="project",
        entity_id=project_id,
        metadata={"extraction_id": extraction_id, "blocking": payload["blocking"], "confirm": payload["confirm"]},
    )


async def _extract(docs: list[ParsedDocument], extraction_id: str, job: jobs.Job) -> tuple[dict, str]:
    """One combined call when everything fits; otherwise one call per document, then a merge."""
    total_tokens = sum(d.estimated_tokens for d in docs)
    inline_bytes = sum(len(d.raw) for d in docs if d.needs_native)
    if len(docs) == 1 or (total_tokens <= SINGLE_CALL_TOKEN_BUDGET and inline_bytes <= MAX_INLINE_PDF_BYTES):
        return await _call_agent("extract", _document_parts(docs), extraction_id), "single"

    job.add_progress("The documents are long, so each one is read separately and the results combined.")
    per_document = await asyncio.gather(*(_call_agent("extract", _document_parts([d]), extraction_id) for d in docs))
    job.add_progress(f"Read all {len(docs)} documents; combining the results.")
    merge_parts = [types.Part(text="Merge these per-document extractions into one.")]
    for doc, extraction in zip(docs, per_document):
        merge_parts.append(
            types.Part(text=f'<document_extraction file="{doc.file_name}">\n{json.dumps(extraction)}\n</document_extraction>')
        )
    return await _call_agent("merge", merge_parts, extraction_id), "per_document"


def _document_parts(docs: list[ParsedDocument]) -> list[types.Part]:
    parts = [types.Part(text=f"Extract the project requirements from these {len(docs)} document(s).")]
    for doc in docs:
        if doc.needs_native:
            parts.append(types.Part(text=f'<attached_file name="{doc.file_name}"/>'))
            parts.append(types.Part.from_bytes(data=doc.raw, mime_type="application/pdf"))
        else:
            # A document can't close its own wrapper tag early and smuggle text outside it.
            body = doc.text.replace("</source_document", "</source_document_")
            parts.append(types.Part(text=f'<source_document file="{doc.file_name}">\n{body}\n</source_document>'))
    return parts


async def _call_agent(kind: str, parts: list[types.Part], session_id: str) -> dict:
    """The only place the extraction touches the LLM (tests replace this function)."""
    agent = build_document_extraction_agent() if kind == "extract" else build_extraction_merge_agent()
    state = await run_agent_to_state(agent, session_id, parts)
    result = state.get("document_extraction")
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except json.JSONDecodeError:
            result = None
    if not isinstance(result, dict):
        raise RuntimeError("The AI couldn't read these documents. Please try again.")
    return result


# ---------------------------------------------------------------------------------------------
# Loading a stored extraction
# ---------------------------------------------------------------------------------------------


def load_extraction(extraction_id: str, current_user: UserPublic) -> dict:
    if not extraction_id.startswith(EXTRACTION_PREFIX):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Extraction not found")
    core._authorize_run_access(extraction_id, current_user)
    folder = core._ensure_local_files(extraction_id, [EXTRACTION_FILE])
    path = folder / EXTRACTION_FILE
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Extraction not found")
    return json.loads(path.read_text(encoding="utf-8"))


def _load_parsed_documents(extraction_id: str, payload: dict) -> list[ParsedDocument]:
    """Rebuilds an earlier extraction's parsed documents from its stored files, without parsing
    them again."""
    files = payload.get("files") or []
    names = [f["stored_name"] for f in files] + [f["text_name"] for f in files if f.get("text_name")]
    folder = core._ensure_local_files(extraction_id, names)
    docs = []
    for entry in files:
        raw_path = folder / entry["stored_name"]
        if not raw_path.exists():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{entry['file_name']} from the earlier upload is no longer available. Please upload all files again.",
            )
        text = ""
        if entry.get("text_name"):
            text_path = folder / entry["text_name"]
            text = text_path.read_text(encoding="utf-8") if text_path.exists() else ""
        docs.append(
            ParsedDocument(
                file_name=entry["file_name"],
                kind=entry["kind"],
                sha256=entry["sha256"],
                size_bytes=entry["size_bytes"],
                text=text,
                page_count=entry.get("page_count"),
                needs_native=bool(entry.get("scanned")),
                raw=raw_path.read_bytes(),
            )
        )
    return docs


# ---------------------------------------------------------------------------------------------
# Generation from a reviewed extraction
# ---------------------------------------------------------------------------------------------


def missing_blocking_fields(form: dict[str, Any], excluded_sections: list[str]) -> list[str]:
    excluded = set(excluded_sections)
    return [
        name for name, _ in core.FORM_FIELDS
        if name in verify.BLOCKING_FIELDS and (name in excluded or verify.is_empty(form.get(name)))
    ]


def _build_source_context(extraction_id: str, payload: dict) -> str:
    """The uploaded documents' text (each capped to its share of SOURCE_CONTEXT_MAX_CHARS) plus the
    extraction's digest. A scanned PDF contributes only through the digest and the form."""
    files = payload.get("files") or []
    text_files = [f for f in files if f.get("text_name")]
    folder = core._ensure_local_files(extraction_id, [f["text_name"] for f in text_files])
    share = SOURCE_CONTEXT_MAX_CHARS // max(len(text_files), 1)
    sections = []
    for entry in files:
        if not entry.get("text_name"):
            sections.append(f'<source_document file="{entry["file_name"]}">[Scanned file: its content is reflected in the form and the digest.]</source_document>')
            continue
        path = folder / entry["text_name"]
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8")
        if len(text) > share:
            text = text[:share] + "\n[...truncated...]"
        text = text.replace("</source_document", "</source_document_")
        sections.append(f'<source_document file="{entry["file_name"]}">\n{text}\n</source_document>')
    digest = (payload.get("digest") or "").strip()
    if digest:
        sections.append(f"<extraction_digest>\n{digest}\n</extraction_digest>")
    return "\n\n".join(sections)


async def start_generation(
    extraction_id: str,
    form: dict[str, Any],
    auto_fields: list[str],
    excluded_sections: list[str],
    *,
    current_user: UserPublic,
    template: Optional[TemplateUsage] = None,
    domain: Optional[DomainChoice] = None,
) -> jobs.Job:
    """template/domain: the same as on the plain form flow (webapp/service.py generate_from_form)
    — a template the user started from before uploading, with a decision for every item it offered."""
    payload = await asyncio.to_thread(load_extraction, extraction_id, current_user)
    missing = missing_blocking_fields(form, excluded_sections)
    if missing:
        labels = ", ".join(FIELD_GUIDE_BY_NAME[name].label for name in missing)
        raise HTTPException(
            status_code=422,  # the Starlette constant's name differs between versions
            detail=f"Please fill in these required fields before generating: {labels}.",
        )
    project = await asyncio.to_thread(projects_service.get_owned_project_or_404, payload["project_id"], current_user)
    template_metadata, domain_context = await asyncio.to_thread(
        templates_service.resolve_generation_context, template, domain
    )
    _check_job_limits(current_user)

    job = jobs.create_job(current_user.user_id, "document_generation", stage="Preparing your documents' content")

    def on_agent_done(agent_name: str) -> None:
        if agent_name in _AGENT_PROGRESS:
            job.add_progress(_AGENT_PROGRESS[agent_name])

    async def work(job: jobs.Job) -> dict:
        job.set_stage("Preparing your documents' content")
        source_context = await asyncio.to_thread(_build_source_context, extraction_id, payload)

        # A project this extraction created was named before the user reviewed the name.
        new_name = (form.get("project_name") or "").strip()
        if payload.get("project_created") and new_name and new_name != project["project_name"]:
            await asyncio.to_thread(projects_repository.rename_project, project["project_id"], new_name)

        job.set_stage("Generating documents (usually 30-90 seconds)")
        result = await core.run_form_generation(
            form,
            auto_fields,
            excluded_sections,
            current_user=current_user,
            project=project,
            generation_type="document_upload",
            source_context=source_context,
            extra_metadata={"source_extraction_id": extraction_id, **template_metadata},
            on_agent_done=on_agent_done,
            domain_context=domain_context,
        )
        if "template" in template_metadata:
            await asyncio.to_thread(
                audit.insert_audit_log,
                user_id=current_user.user_id,
                action="TEMPLATE_APPLIED",
                entity_type="template",
                entity_id=template_metadata["template"]["template_id"],
                metadata={
                    "run_id": result["run_id"],
                    "version": template_metadata["template"]["version"],
                    "source_extraction_id": extraction_id,
                    **template_metadata["template"]["summary"],
                },
            )
        return {
            "run_id": result["run_id"],
            "project_id": result["project_id"],
            "project_name": (result.get("requirements_json") or {}).get("project_name") or new_name,
            "missing": result.get("missing") or [],
        }

    await jobs.launch(job, work)
    return job
