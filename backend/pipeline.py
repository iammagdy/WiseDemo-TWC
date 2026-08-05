"""End-to-end pipeline orchestrator."""
from __future__ import annotations

import asyncio
import os
import shutil
import traceback
from datetime import datetime, timezone
from uuid import uuid4

from db import update_job
from services import scraper_service, gemini_service, steel_service, tts_service, composer_service


BASE_DIR = os.environ.get("APP_BASE_DIR", "/app/backend")
VIDEOS_DIR = os.path.join(BASE_DIR, "videos")
TMP_DIR = os.path.join(BASE_DIR, "tmp")
os.makedirs(VIDEOS_DIR, exist_ok=True)
os.makedirs(TMP_DIR, exist_ok=True)


async def _set(job_id: str, **fields) -> None:
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    await update_job(job_id, fields)


async def run_pipeline(job_id: str, url: str) -> None:
    tmp = os.path.join(TMP_DIR, job_id)
    os.makedirs(tmp, exist_ok=True)
    try:
        # 1. Scrape
        await _set(job_id, status="analyzing", progress=8, step="Reading your product page")
        snapshot = await scraper_service.scrape_url(url)

        # 2. Gemini analysis
        await _set(job_id, status="analyzing", progress=18, step="Understanding what you offer")
        product = await gemini_service.analyze_product(snapshot)

        # 3. Gemini plan
        await _set(job_id, status="planning", progress=30, step="Scripting your 45-second demo")
        plan = await gemini_service.plan_demo(product, snapshot.get("url", url))
        actions = plan.get("actions") or []
        scenes = plan.get("scenes") or []
        if not actions or not scenes:
            raise RuntimeError("Gemini plan came back empty.")

        # 4. Record with Steel
        await _set(job_id, status="recording", progress=45, step="Filming your product on a cloud browser")
        result = await steel_service.record_tour(actions)
        session_id = result["session_id"]
        cursor_keyframes = result.get("cursor_keyframes") or []
        viewport = result.get("viewport") or None

        # 5. Fetch MP4
        await _set(job_id, status="fetching", progress=62, step="Downloading the raw footage")
        raw_mp4 = os.path.join(tmp, "raw.mp4")
        await steel_service.fetch_recording_mp4(session_id, raw_mp4)

        # 6. TTS voiceover in parallel with any prep
        await _set(job_id, status="voiceover", progress=75, step="Recording the voiceover")
        narration = " ".join([s.get("narration", "").strip() for s in scenes if s.get("narration")])
        narration = narration[:3800]  # TTS limit
        voice_mp3 = os.path.join(tmp, "voice.mp3")
        await tts_service.synthesize_voiceover(narration, voice_mp3, voice="onyx", model="tts-1-hd")

        # 7. Compose
        await _set(job_id, status="composing", progress=88, step="Editing captions, cards, and audio")
        final_mp4 = os.path.join(VIDEOS_DIR, f"{job_id}.mp4")
        await composer_service.compose_final(
            raw_mp4,
            voice_mp3,
            product,
            scenes,
            tmp,
            final_mp4,
            cursor_keyframes=cursor_keyframes,
            viewport=viewport,
        )

        # 8. Ready
        duration = await composer_service.probe_duration(final_mp4)
        await _set(
            job_id,
            status="ready",
            progress=100,
            step="Your demo is ready",
            product=product,
            plan=plan,
            steel_session_id=session_id,
            duration_seconds=round(duration, 2),
            video_path=final_mp4,
            error=None,
        )
    except Exception as e:
        tb = traceback.format_exc()
        print(f"[pipeline] job {job_id} failed:\n{tb}")
        await _set(
            job_id,
            status="failed",
            step="Something went wrong",
            error=str(e)[:500],
        )
    finally:
        # Keep tmp for debugging pipelines regardless of success/failure.
        pass
