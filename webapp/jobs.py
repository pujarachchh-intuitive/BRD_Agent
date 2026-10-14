"""In-memory background jobs for work that outlasts one HTTP request (document extraction, and
generation from an extraction).

Azure Container Apps' ingress times a request out at 240 s, and the Next.js proxy at 180 s, so a
long pipeline can't safely run inside a request. Instead the request starts an asyncio task and
returns a job_id, and the browser polls GET /api/jobs/{job_id}.

Job state lives only in this process's memory, which is deliberate: polling every few seconds must
never touch Databricks, or the SQL warehouse would never auto-stop. Two consequences for
deployment:
- Run the backend with max replicas = 1 (or session affinity), so a poll reaches the replica
  that owns the job.
- A job in flight is lost if the container restarts. The poll then returns 404 and the UI asks
  the user to try again. Finished results are always persisted to Databricks by the job itself.
"""

import asyncio
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Optional

from fastapi import HTTPException, status

# Finished jobs are kept this long so a slow poller still sees the result, then dropped.
_RETENTION_SECONDS = 60 * 60

# Tests set this to run jobs inline, since TestClient tears its event loop down per request.
RUN_EAGERLY = False


@dataclass
class Job:
    job_id: str
    user_id: str
    kind: str
    status: str = "running"  # "running" | "succeeded" | "failed"
    stage: str = "Starting"
    progress: list[str] = field(default_factory=list)
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def set_stage(self, stage: str) -> None:
        self.stage = stage
        self.updated_at = time.time()

    def add_progress(self, message: str) -> None:
        self.progress.append(message)
        self.updated_at = time.time()

    def succeed(self, result: dict) -> None:
        self.result = result
        self.status = "succeeded"
        self.set_stage("Done")

    def public(self) -> dict:
        return {
            "job_id": self.job_id,
            "kind": self.kind,
            "status": self.status,
            "stage": self.stage,
            "progress": list(self.progress),
            "result": self.result,
            "error": self.error,
        }


_jobs: dict[str, Job] = {}
# Strong references to running tasks: the event loop only keeps weak ones, so an unreferenced
# task can be garbage-collected mid-run.
_tasks: set[asyncio.Task] = set()


def _prune() -> None:
    cutoff = time.time() - _RETENTION_SECONDS
    for job_id in [j.job_id for j in _jobs.values() if j.status != "running" and j.updated_at < cutoff]:
        _jobs.pop(job_id, None)


def create_job(user_id: str, kind: str, stage: str = "Starting") -> Job:
    _prune()
    job = Job(job_id=uuid.uuid4().hex, user_id=user_id, kind=kind, stage=stage)
    _jobs[job.job_id] = job
    return job


def running_jobs_for(user_id: str) -> int:
    return sum(1 for j in _jobs.values() if j.user_id == user_id and j.status == "running")


def get_job_for_user(job_id: str, user_id: str) -> Job:
    """404 for both "no such job" and "someone else's job", same as projects."""
    job = _jobs.get(job_id)
    if job is None or job.user_id != user_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found. It may have expired, or the server restarted while it was running.",
        )
    return job


async def _run(job: Job, work: Callable[[Job], Awaitable[dict]]) -> None:
    try:
        job.succeed(await work(job))
    except HTTPException as exc:
        job.status = "failed"
        job.error = str(exc.detail)
        job.set_stage("Failed")
    except Exception as exc:  # noqa: BLE001 — surface any failure to the polling UI
        job.status = "failed"
        job.error = str(exc) or type(exc).__name__
        job.set_stage("Failed")
        print(f"Job {job.job_id} ({job.kind}) failed: {exc!r}")


async def launch(job: Job, work: Callable[[Job], Awaitable[dict]]) -> None:
    if RUN_EAGERLY:
        await _run(job, work)
        return
    task = asyncio.get_running_loop().create_task(_run(job, work))
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)


class RateLimiter:
    """Sliding-window per-user limit, in memory (fine at one replica). Protects the LLM budget
    from a stuck client or a user uploading in a loop."""

    def __init__(self, limit: int, window_seconds: int):
        self.limit = limit
        self.window_seconds = window_seconds
        self._hits: dict[str, deque] = {}

    def check(self, key: str) -> None:
        now = time.time()
        hits = self._hits.setdefault(key, deque())
        while hits and hits[0] < now - self.window_seconds:
            hits.popleft()
        if len(hits) >= self.limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"You've reached the limit of {self.limit} document uploads per day. Please try again later.",
            )
        hits.append(now)

    def reset(self) -> None:
        self._hits.clear()


def clear_all() -> None:
    """Tests only."""
    _jobs.clear()
