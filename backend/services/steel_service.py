"""Steel session driver + HLS-to-MP4 conversion.

Creates a Steel session (headful, auto-records), controls it with Playwright over CDP
to perform a scripted tour, releases the session, then pulls the durable MP4/HLS.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
from typing import Any

import httpx
from playwright.async_api import async_playwright
from steel import Steel


STEEL_API = "https://api.steel.dev"


def _client() -> Steel:
    return Steel(steel_api_key=os.environ["STEEL_API_KEY"])


async def _do_action(page, action: dict) -> None:
    t = action.get("type")
    wait = int(action.get("wait_ms", 1500)) / 1000.0
    try:
        if t == "goto":
            await page.goto(action["url"], wait_until="load", timeout=30000)
        elif t == "scroll":
            y = int(action.get("y", 500))
            await page.evaluate(
                "(y)=>window.scrollTo({top:y, behavior:'smooth'})", y
            )
        elif t == "hover":
            txt = str(action.get("text", ""))[:60]
            if txt:
                loc = page.get_by_text(txt, exact=False).first
                try:
                    await loc.hover(timeout=3000)
                except Exception:
                    pass
        elif t == "wait":
            pass
    except Exception as e:
        print(f"[steel] action {t} failed softly: {e}")
    await asyncio.sleep(wait)


async def record_tour(actions: list[dict]) -> dict:
    """Create Steel session, run actions, release, return session metadata."""
    client = _client()
    api_key = os.environ["STEEL_API_KEY"]

    session = client.sessions.create(
        dimensions={"width": 1440, "height": 900},
    )
    session_id = session.id
    ws = session.websocket_url

    async def _run():
        async with async_playwright() as pw:
            browser = await pw.chromium.connect_over_cdp(f"{ws}&apiKey={api_key}")
            try:
                ctx = browser.contexts[0]
                page = ctx.pages[0] if ctx.pages else await ctx.new_page()
                # Small warmup so recording engine is fully attached
                await asyncio.sleep(2)
                for act in actions:
                    await _do_action(page, act)
                # Hold on final view a moment
                await asyncio.sleep(1.5)
            finally:
                try:
                    await browser.close()
                except Exception:
                    pass

    try:
        await _run()
    finally:
        try:
            client.sessions.release(session_id)
        except Exception as e:
            print(f"[steel] release warn: {e}")

    return {"session_id": session_id}


async def _download_ready(session_id: str) -> bytes | None:
    """Poll Steel for an HLS manifest that indicates the recording is finalized."""
    api_key = os.environ["STEEL_API_KEY"]
    url = f"{STEEL_API}/v1/sessions/{session_id}/hls"
    headers = {"steel-api-key": api_key}
    async with httpx.AsyncClient(timeout=30.0, headers=headers) as http:
        for attempt in range(30):
            r = await http.get(url)
            if r.status_code == 200 and b"#EXT-X-ENDLIST" in r.content:
                return r.content
            await asyncio.sleep(2)
    return None


async def fetch_recording_mp4(session_id: str, out_path: str) -> str:
    """Poll HLS until finalized and use ffmpeg to remux to a progressive MP4."""
    manifest = await _download_ready(session_id)
    if not manifest:
        raise RuntimeError(f"Steel HLS for session {session_id} did not finalize in time.")

    api_key = os.environ["STEEL_API_KEY"]
    hls_url = f"{STEEL_API}/v1/sessions/{session_id}/hls"
    # ffmpeg can consume the HLS master directly with auth header injected.
    headers = f"steel-api-key: {api_key}\r\n"
    cmd = [
        "ffmpeg", "-y",
        "-headers", headers,
        "-i", hls_url,
        "-c", "copy",
        "-movflags", "+faststart",
        out_path,
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0 or not os.path.exists(out_path) or os.path.getsize(out_path) < 1024:
        # Try again re-encoding, sometimes copy fails on fragmented MP4
        cmd = [
            "ffmpeg", "-y",
            "-headers", headers,
            "-i", hls_url,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-c:a", "aac", "-b:a", "128k",
            "-movflags", "+faststart",
            out_path,
        ]
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        _, err = await proc.communicate()
        if proc.returncode != 0:
            raise RuntimeError(f"ffmpeg HLS→MP4 failed: {err.decode('utf-8', 'ignore')[:400]}")

    return out_path
