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
