"""Resilience tests for WiseDemo backend job recovery.

Covers:
- Stuck job f6c07705 now returns failed with human-readable error
- Startup recovery marks orphan (non-terminal) jobs as failed
- Stall detection via GET /api/jobs/{id} auto-fails stalled jobs
- Fresh job creation still succeeds
- List endpoint returns newest-first including failed jobs
"""
from __future__ import annotations

import os
import subprocess
import time
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
import requests
from pymongo import MongoClient
from dotenv import load_dotenv

load_dotenv("/app/backend/.env")
load_dotenv("/app/frontend/.env")

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]

STUCK_ID = "f6c07705-ceb0-43d6-9e04-577175f20b7c"


@pytest.fixture(scope="module")
def mongo():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture
def cleanup_ids(mongo):
    ids: list[str] = []
    yield ids
    if ids:
        mongo.jobs.delete_many({"id": {"$in": ids}})


def _iso(dt: datetime) -> str:
    return dt.isoformat()


def _seed_job(mongo, status: str, progress: int, updated_delta_seconds: int = 0) -> str:
    now = datetime.now(timezone.utc)
    updated_at = now - timedelta(seconds=updated_delta_seconds)
    jid = str(uuid4())
    mongo.jobs.insert_one({
        "id": jid,
        "url": "https://example.com",
        "status": status,
        "progress": progress,
        "step": "recording",
        "created_at": _iso(now - timedelta(seconds=updated_delta_seconds)),
        "updated_at": _iso(updated_at),
    })
    return jid


def test_health():
    r = requests.get(f"{BASE_URL}/api/health", timeout=15)
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_previously_stuck_job_now_failed(mongo):
    """The reported stuck job f6c07705 must return status=failed with a human-readable error."""
    doc = mongo.jobs.find_one({"id": STUCK_ID})
    if not doc:
        pytest.skip(f"Stuck job {STUCK_ID} no longer present in DB")

    r = requests.get(f"{BASE_URL}/api/jobs/{STUCK_ID}", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "failed", f"expected failed, got {data['status']}"
    err = (data.get("error") or "").lower()
    assert any(k in err for k in ("interrupted", "restarted", "stalled", "progress", "try again")), (
        f"error message not human-readable: {data.get('error')!r}"
    )
    # progress should be frozen (not reset to 0). Original was 45.
    assert isinstance(data.get("progress"), int)


def test_startup_recovery_marks_orphan_failed(mongo, cleanup_ids):
    """Seed a non-terminal job, restart backend, GET must return failed with interrupted/restarted msg."""
    jid = _seed_job(mongo, status="recording", progress=50, updated_delta_seconds=5)
    cleanup_ids.append(jid)

    # Restart backend
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"], check=True, capture_output=True)

    # Wait for backend to come back up
    deadline = time.time() + 45
    while time.time() < deadline:
        try:
            h = requests.get(f"{BASE_URL}/api/health", timeout=3)
            if h.status_code == 200:
                break
        except Exception:
            pass
        time.sleep(1)
    else:
        pytest.fail("Backend did not come back up in 45s")

    # Give startup event a moment
    time.sleep(1.5)

    r = requests.get(f"{BASE_URL}/api/jobs/{jid}", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "failed", f"expected failed after startup recovery, got {data}"
    err = (data.get("error") or "").lower()
    assert "interrupted" in err or "restarted" in err, f"unexpected error text: {data.get('error')!r}"


def test_stall_detection_on_read(mongo, cleanup_ids):
    """Seed a job with updated_at 10 min ago; GET should trigger stall detection and mark failed."""
    jid = _seed_job(mongo, status="recording", progress=45, updated_delta_seconds=600)
    cleanup_ids.append(jid)

    r = requests.get(f"{BASE_URL}/api/jobs/{jid}", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "failed", f"expected failed after stall check, got {data}"
    err = (data.get("error") or "").lower()
    assert any(k in err for k in ("progress", "stalled", "try again")), (
        f"unexpected stall error message: {data.get('error')!r}"
    )


def test_stall_detection_does_not_fail_fresh_job(mongo, cleanup_ids):
    """A non-terminal job with recent updated_at should NOT be flipped to failed."""
    jid = _seed_job(mongo, status="recording", progress=45, updated_delta_seconds=10)
    cleanup_ids.append(jid)

    r = requests.get(f"{BASE_URL}/api/jobs/{jid}", timeout=15)
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "recording", f"fresh job should not be failed, got {data}"


def test_create_job_still_works(mongo, cleanup_ids):
    """POST /api/jobs remains healthy: returns queued job with progress > 0."""
    r = requests.post(f"{BASE_URL}/api/jobs", json={"url": "https://linear.app"}, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["status"] == "queued"
    assert data["progress"] > 0
    assert data["url"].startswith("https://linear.app")
    assert isinstance(data["id"], str) and len(data["id"]) > 0
    cleanup_ids.append(data["id"])


def test_list_jobs_newest_first_includes_failed(mongo):
    """GET /api/jobs returns sorted newest-first list, failed jobs visible."""
    r = requests.get(f"{BASE_URL}/api/jobs", timeout=15)
    assert r.status_code == 200
    jobs = r.json()
    assert isinstance(jobs, list)
    assert len(jobs) > 0
    # newest first
    created = [j.get("created_at", "") for j in jobs]
    assert created == sorted(created, reverse=True), "jobs are not sorted newest-first"
    # failed jobs are present in list
    statuses = {j["status"] for j in jobs}
    assert "failed" in statuses, f"no failed jobs visible in list; statuses={statuses}"
