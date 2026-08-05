"""FastAPI server: submit a URL, monitor a job, download the final video."""
from __future__ import annotations

import asyncio
import mimetypes
import os
import re
from datetime import datetime, timezone
from uuid import uuid4

from dotenv import load_dotenv

# Load env from /app/backend/.env before anything imports it
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), ".env"))

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

import db
import pipeline


app = FastAPI(title="WiseDemo API")


@app.on_event("startup")
async def _startup() -> None:
    """Reset any jobs that were mid-flight when the server was last stopped."""
    try:
        n = await db.mark_orphans_failed()
        if n:
            print(f"[startup] marked {n} orphan job(s) as failed after restart")
    except Exception as e:
        print(f"[startup] orphan recovery skipped: {e}")


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class CreateJob(BaseModel):
    url: str = Field(min_length=4, max_length=500)


class JobOut(BaseModel):
    id: str
    url: str
    status: str
    progress: int
    step: str
    created_at: str
    updated_at: str
    error: str | None = None
    duration_seconds: float | None = None
    product: dict | None = None
    video_url: str | None = None


URL_RE = re.compile(r"^(https?://)?[^\s]{4,}$", re.I)


def _normalize_url(u: str) -> str:
    u = u.strip()
    if not URL_RE.match(u):
        raise HTTPException(status_code=400, detail="Enter a valid website URL.")
    if not u.startswith(("http://", "https://")):
        u = "https://" + u
    return u


def _to_out(doc: dict) -> JobOut:
    video_url = None
    if doc.get("status") == "ready" and doc.get("video_path"):
        video_url = f"/api/jobs/{doc['id']}/video"
    return JobOut(
        id=doc["id"],
        url=doc.get("url", ""),
        status=doc.get("status", "queued"),
        progress=int(doc.get("progress", 0)),
        step=doc.get("step", ""),
        created_at=doc.get("created_at", ""),
        updated_at=doc.get("updated_at", ""),
        error=doc.get("error"),
        duration_seconds=doc.get("duration_seconds"),
        product=doc.get("product"),
        video_url=video_url,
    )


@app.get("/api/health")
async def health():
    return {"ok": True, "time": datetime.now(timezone.utc).isoformat()}


@app.post("/api/jobs", response_model=JobOut)
async def create_job(body: CreateJob):
    url = _normalize_url(body.url)
    job_id = str(uuid4())
    now = datetime.now(timezone.utc).isoformat()
    doc = {
        "id": job_id,
        "url": url,
        "status": "queued",
        "progress": 2,
        "step": "Queued",
        "created_at": now,
        "updated_at": now,
    }
    await db.create_job(doc)
    # Fire-and-forget background task
    asyncio.create_task(pipeline.run_pipeline(job_id, url))
    return _to_out(doc)


@app.get("/api/jobs", response_model=list[JobOut])
async def list_jobs():
    docs = await db.list_jobs()
    return [_to_out(d) for d in docs]


@app.get("/api/jobs/{job_id}", response_model=JobOut)
async def get_job(job_id: str):
    doc = await db.get_job(job_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Job not found")
    # Auto-fail jobs that haven't progressed in 5 minutes so the UI never
    # perpetually spins on an orphaned/crashed background task.
    try:
        if doc.get("status") not in ("ready", "failed"):
            n = await db.mark_stalled_failed(stall_seconds=300)
            if n:
                doc = await db.get_job(job_id) or doc
    except Exception:
        pass
    return _to_out(doc)


@app.get("/api/jobs/{job_id}/video")
async def get_video(job_id: str, request: Request, download: int = 0):
    doc = await db.get_job(job_id)
    if not doc or doc.get("status") != "ready" or not doc.get("video_path"):
        raise HTTPException(status_code=404, detail="Video not ready")
    path = doc["video_path"]
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Video file missing")
    filename = f"{(doc.get('product') or {}).get('product_name','demo').replace(' ','_')}-{job_id[:8]}.mp4"
    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    return FileResponse(path, media_type="video/mp4", headers=headers)
