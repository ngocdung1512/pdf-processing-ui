"""
Lightweight runtime state for coordinating ingest/chat load.
"""
from threading import Lock

_lock = Lock()
_active_ingest_jobs = 0


def begin_ingest() -> None:
    global _active_ingest_jobs
    with _lock:
        _active_ingest_jobs += 1


def end_ingest() -> None:
    global _active_ingest_jobs
    with _lock:
        _active_ingest_jobs = max(0, _active_ingest_jobs - 1)


def is_ingest_busy() -> bool:
    with _lock:
        return _active_ingest_jobs > 0


def snapshot() -> dict:
    with _lock:
        return {"active_ingest_jobs": _active_ingest_jobs}

