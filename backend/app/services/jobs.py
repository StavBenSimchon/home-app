"""In-memory job store for long-running AI calls.

The app runs a single uvicorn worker with replicaCount=1, so a process-local
dict is safe. Jobs are short-lived (TTL 1h); a pod restart loses them — the
client surfaces the error and the user retries.
"""

import asyncio
import traceback
import uuid
from collections.abc import Awaitable, Callable
from datetime import datetime, timedelta, timezone
from typing import Any

JOBS_TTL = timedelta(hours=1)

_jobs: dict[str, dict[str, Any]] = {}
_tasks: set[asyncio.Task] = set()


def _purge() -> None:
    now = datetime.now(timezone.utc)
    for job_id in [jid for jid, j in _jobs.items() if now - j["created_at"] > JOBS_TTL]:
        del _jobs[job_id]


def start_job(work: Callable[[], Awaitable[Any]]) -> str:
    """Schedule work() in the background and return its job id."""
    _purge()
    job_id = uuid.uuid4().hex
    _jobs[job_id] = {
        "status": "pending",
        "result": None,
        "error": None,
        "created_at": datetime.now(timezone.utc),
    }

    async def runner() -> None:
        try:
            result = await work()
        except Exception as e:
            traceback.print_exc()
            _jobs[job_id].update(status="error", error=str(e) or repr(e))
        else:
            _jobs[job_id].update(status="done", result=result)

    task = asyncio.create_task(runner())
    _tasks.add(task)  # keep a strong ref so the task isn't GC'd mid-run
    task.add_done_callback(_tasks.discard)
    return job_id


def get_job(job_id: str) -> dict[str, Any] | None:
    job = _jobs.get(job_id)
    if not job:
        return None
    return {"status": job["status"], "result": job["result"], "error": job["error"]}
