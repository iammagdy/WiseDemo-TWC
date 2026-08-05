"""Steel session driver + HLS-to-MP4 conversion + cursor keyframe tracking.

Creates a Steel session (headful, auto-records), controls it with Playwright over CDP
to perform a scripted tour, releases the session, then pulls the durable MP4/HLS.

During the tour we deliberately move the mouse cursor to the point of interest for
each action and log a `(elapsed_ms, x, y)` keyframe. Those keyframes are later fed
to the composer to build a cinematic cursor-follow zoom.
"""
from __future__ import annotations

import asyncio
import os
import time
import subprocess
from typing import Any

import httpx
from playwright.async_api import async_playwright
from steel import Steel


STEEL_API = "https://api.steel.dev"

# Viewport dimensions requested from Steel (must match sessions.create dimensions).
VIEWPORT_W, VIEWPORT_H = 1440, 900


def _client() -> Steel:
    return Steel(steel_api_key=os.environ["STEEL_API_KEY"])


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


class CursorTracker:
    """Collect (elapsed_ms, viewport_x, viewport_y) keyframes as the tour runs."""

    def __init__(self, session_start: float) -> None:
        self.session_start = session_start
        self.keyframes: list[tuple[int, float, float]] = []

    def _t_ms(self) -> int:
        return int((time.monotonic() - self.session_start) * 1000)

    def log(self, x: float, y: float) -> None:
        x = _clamp(x, 0, VIEWPORT_W)
        y = _clamp(y, 0, VIEWPORT_H)
        self.keyframes.append((self._t_ms(), float(x), float(y)))


async def _hover_element_by_text(page, text: str, tracker: CursorTracker) -> bool:
    """Move the real cursor smoothly to the bounding-box center of a matching element."""
    try:
        loc = page.get_by_text(text, exact=False).first
        box = await loc.bounding_box(timeout=3000)
        if not box:
            return False
        cx = box["x"] + box["width"] / 2
        cy = box["y"] + box["height"] / 2
        await page.mouse.move(cx, cy, steps=25)
        tracker.log(cx, cy)
        return True
    except Exception:
        return False


async def _do_action(page, action: dict, tracker: CursorTracker, index: int) -> None:
    t = action.get("type")
    wait = int(action.get("wait_ms", 1500)) / 1000.0
    try:
        if t == "goto":
            await page.goto(action["url"], wait_until="load", timeout=30000)
            # Rest the cursor above the first fold so the intro feels natural.
            await page.mouse.move(VIEWPORT_W * 0.35, VIEWPORT_H * 0.35, steps=18)
            tracker.log(VIEWPORT_W * 0.35, VIEWPORT_H * 0.35)
        elif t == "scroll":
            y = int(action.get("y", 500))
            await page.evaluate(
                "(y)=>window.scrollTo({top:y, behavior:'smooth'})", y
            )
            # Alternate a "reading eye" position so the pan doesn't feel robotic.
            side = 0.35 if index % 2 == 0 else 0.65
            tx = VIEWPORT_W * side
            ty = VIEWPORT_H * (0.4 + (0.05 if index % 3 == 0 else -0.05))
            await page.mouse.move(tx, ty, steps=20)
            tracker.log(tx, ty)
        elif t == "hover":
            txt = str(action.get("text", ""))[:60]
            if txt and await _hover_element_by_text(page, txt, tracker):
                pass
            else:
                # Fallback: light drift toward centre.
                await page.mouse.move(VIEWPORT_W * 0.5, VIEWPORT_H * 0.5, steps=15)
                tracker.log(VIEWPORT_W * 0.5, VIEWPORT_H * 0.5)
        elif t == "wait":
            pass
    except Exception as e:
        print(f"[steel] action {t} failed softly: {e}")
    await asyncio.sleep(wait)


async def record_tour(actions: list[dict]) -> dict:
    """Create Steel session, run scripted tour with cursor tracking, release, return metadata."""
    client = _client()
    api_key = os.environ["STEEL_API_KEY"]

    session_start = time.monotonic()

    # Steel SDK is sync; run its blocking calls in a thread to keep the loop responsive.
    session = await asyncio.to_thread(
        client.sessions.create,
        dimensions={"width": VIEWPORT_W, "height": VIEWPORT_H},
    )
    session_id = session.id
    ws = session.websocket_url

    tracker = CursorTracker(session_start)
    # Prepend a synthetic "start at center" keyframe so the crop expression has a t=0 anchor.
    tracker.keyframes.append((0, VIEWPORT_W * 0.5, VIEWPORT_H * 0.4))
    recording_started_ms: int | None = None

    async def _run():
        nonlocal recording_started_ms
        async with async_playwright() as pw:
            browser = await pw.chromium.connect_over_cdp(f"{ws}&apiKey={api_key}")
            try:
                ctx = browser.contexts[0]
                page = ctx.pages[0] if ctx.pages else await ctx.new_page()
                # Small warmup so the CDP page is ready and the recorder is attached.
                await asyncio.sleep(2)
                recording_started_ms = tracker._t_ms()
                for i, act in enumerate(actions):
                    await _do_action(page, act, tracker, i)
                # Hold on final view a moment
                await asyncio.sleep(1.5)
                tracker.log(*tracker.keyframes[-1][1:])  # hold last position
            finally:
                try:
                    await browser.close()
                except Exception:
                    pass

    try:
        await _run()
    finally:
        try:
            await asyncio.to_thread(client.sessions.release, session_id)
        except Exception as e:
            print(f"[steel] release warn: {e}")

    return {
        "session_id": session_id,
        "cursor_keyframes": tracker.keyframes,
        "recording_started_ms": recording_started_ms or 0,
        "viewport": {"width": VIEWPORT_W, "height": VIEWPORT_H},
    }


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
