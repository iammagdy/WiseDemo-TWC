"""MongoDB motor client and simple job repository."""
from __future__ import annotations

import os
from typing import Any, Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase


_client: Optional[AsyncIOMotorClient] = None
_db: Optional[AsyncIOMotorDatabase] = None


def get_db() -> AsyncIOMotorDatabase:
    global _client, _db
    if _db is None:
        mongo_url = os.environ["MONGO_URL"]
        db_name = os.environ["DB_NAME"]
        _client = AsyncIOMotorClient(mongo_url)
        _db = _client[db_name]
    return _db


async def create_job(doc: dict[str, Any]) -> None:
    await get_db().jobs.insert_one(doc)


async def update_job(job_id: str, updates: dict[str, Any]) -> None:
    await get_db().jobs.update_one({"id": job_id}, {"$set": updates})


async def get_job(job_id: str) -> Optional[dict[str, Any]]:
    doc = await get_db().jobs.find_one({"id": job_id}, {"_id": 0})
    return doc


async def list_jobs(limit: int = 50) -> list[dict[str, Any]]:
    cur = get_db().jobs.find({}, {"_id": 0}).sort("created_at", -1).limit(limit)
    return [d async for d in cur]


async def mark_orphans_failed() -> int:
    """Mark any jobs stuck in a non-terminal state as failed (called on startup)."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    r = await get_db().jobs.update_many(
        {"status": {"$nin": ["ready", "failed"]}},
        {
            "$set": {
                "status": "failed",
                "step": "Server restarted mid-pipeline",
                "error": "The render pipeline was interrupted (server restart or reload). Please start a new job.",
                "updated_at": now,
            }
        },
    )
    return r.modified_count


async def mark_stalled_failed(stall_seconds: int = 300) -> int:
    """Mark jobs whose updated_at is older than `stall_seconds` and status non-terminal as failed."""
    from datetime import datetime, timezone, timedelta
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(seconds=stall_seconds)).isoformat()
    r = await get_db().jobs.update_many(
        {"status": {"$nin": ["ready", "failed"]}, "updated_at": {"$lt": cutoff}},
        {
            "$set": {
                "status": "failed",
                "step": "Timed out",
                "error": f"No progress for {stall_seconds//60} minutes. The recording may have stalled. Please try again.",
                "updated_at": now.isoformat(),
            }
        },
    )
    return r.modified_count
