"""FFmpeg-based composition: intro, main clip with captions, voiceover, outro.

Builds a professional-feeling 1080p demo out of raw Steel MP4 + narration audio.
No Node/Remotion needed.
"""
from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
from typing import Any


CANVAS_W, CANVAS_H = 1920, 1080  # 16:9
FPS = 30
INTRO_SEC = 2.5
OUTRO_SEC = 3.0


def _hex_to_ffcolor(hex_color: str, fallback: str = "0x111111") -> str:
    hex_color = (hex_color or "").strip()
    if hex_color.startswith("#") and len(hex_color) in (7, 4):
        return "0x" + hex_color[1:]
    return fallback


def _escape(text: str) -> str:
    """Escape text for ffmpeg drawtext filter (single-line)."""
    text = (text or "").replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    return text


async def _run(cmd: list[str]) -> None:
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {' '.join(cmd[:4])}... :: {err.decode('utf-8','ignore')[:400]}")


async def probe_duration(path: str) -> float:
    cmd = ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", path]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    out, _ = await proc.communicate()
    try:
        j = json.loads(out.decode("utf-8", "ignore"))
        return float(j["format"]["duration"])
    except Exception:
        return 0.0


# Choose a bundled TTF font — DejaVu is available on Debian
FONT_BOLD = None
FONT_REG = None


def _find_fonts() -> tuple[str, str]:
    global FONT_BOLD, FONT_REG
    if FONT_BOLD and FONT_REG:
        return FONT_BOLD, FONT_REG
    candidates_bold = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    ]
    candidates_reg = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for c in candidates_bold:
        if os.path.exists(c):
            FONT_BOLD = c
            break
    for c in candidates_reg:
        if os.path.exists(c):
            FONT_REG = c
            break
    if not FONT_BOLD:
        FONT_BOLD = shutil.which("fc-match") and "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    if not FONT_REG:
        FONT_REG = FONT_BOLD
    return FONT_BOLD, FONT_REG


async def make_card(text_top: str, text_sub: str, out_path: str, duration: float, bg_hex: str) -> str:
    """Render a solid-color card with two lines of text via ffmpeg lavfi."""
    bold, reg = _find_fonts()
    bg = _hex_to_ffcolor(bg_hex, "0x0B0F1A")
    top = _escape(text_top)
    sub = _escape(text_sub)

    # Auto-scale font by length so long sentences don't overflow 1920px wide.
    top_len = max(1, len(text_top))
    top_size = 108 if top_len <= 12 else (84 if top_len <= 22 else (64 if top_len <= 38 else 48))
    sub_len = max(1, len(text_sub))
    sub_size = 44 if sub_len <= 40 else (36 if sub_len <= 70 else 30)

    # Fade in/out for softness
    filt = (
        f"drawtext=fontfile={bold}:text='{top}':fontcolor=white:fontsize={top_size}"
        f":x=(w-text_w)/2:y=(h/2)-{top_size + 20}"
        f",drawtext=fontfile={reg}:text='{sub}':fontcolor=0xFFFFFFCC:fontsize={sub_size}"
        f":x=(w-text_w)/2:y=(h/2)+20"
        f",fade=t=in:st=0:d=0.4,fade=t=out:st={max(0.1, duration-0.4):.2f}:d=0.4"
    )
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi",
        "-i", f"color=c={bg}:s={CANVAS_W}x{CANVAS_H}:r={FPS}:d={duration}",
        "-vf", filt,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p",
        out_path,
    ]
    await _run(cmd)
    return out_path


async def scale_to_canvas(input_mp4: str, out_path: str) -> str:
    """Scale/pad the raw recording to the target 1920x1080 canvas, preserving AR."""
    filt = (
        f"scale={CANVAS_W}:{CANVAS_H}:force_original_aspect_ratio=decrease,"
        f"pad={CANVAS_W}:{CANVAS_H}:(ow-iw)/2:(oh-ih)/2:color=0x0B0F1A,"
        f"setsar=1,fps={FPS}"
    )
    cmd = [
        "ffmpeg", "-y", "-i", input_mp4,
        "-vf", filt,
        "-an",  # drop original silent audio
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p",
        out_path,
    ]
    await _run(cmd)
    return out_path


async def add_captions(main_mp4: str, scenes: list[dict], out_path: str, bg_hex: str) -> str:
    """Overlay animated lower-third captions per scene evenly across the clip."""
    dur = await probe_duration(main_mp4)
    if dur <= 0 or not scenes:
        shutil.copyfile(main_mp4, out_path)
        return out_path

    bold, _ = _find_fonts()
    per = dur / max(1, len(scenes))
    filters = []
    accent = _hex_to_ffcolor(bg_hex, "0x6366F1").replace("0x", "0x")
    # Draw a semi-transparent bar and text per scene, timed enable
    for i, sc in enumerate(scenes):
        caption = _escape(str(sc.get("caption", ""))[:80])
        if not caption:
            continue
        start = i * per
        end = (i + 1) * per
        # Give text a small fade window inside its scene
        fade_in = start + 0.2
        fade_out = end - 0.2
        # Background bar
        filters.append(
            f"drawbox=x=0:y=h-180:w=iw:h=180:color=black@0.55:t=fill:enable='between(t,{start:.2f},{end:.2f})'"
        )
        # Accent stripe
        filters.append(
            f"drawbox=x=80:y=h-180:w=8:h=180:color={accent}@0.9:t=fill:enable='between(t,{start:.2f},{end:.2f})'"
        )
        # Caption text
        filters.append(
            f"drawtext=fontfile={bold}:text='{caption}':fontcolor=white:fontsize=54"
            f":x=120:y=h-130:enable='between(t,{fade_in:.2f},{fade_out:.2f})'"
        )

    vf = ",".join(filters)
    cmd = [
        "ffmpeg", "-y", "-i", main_mp4,
        "-vf", vf,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p",
        "-an",
        out_path,
    ]
    await _run(cmd)
    return out_path


async def mux_voiceover(video_mp4: str, voice_mp3: str, out_path: str) -> str:
    """Mux voiceover audio onto the video, matching lengths (video is master)."""
    cmd = [
        "ffmpeg", "-y",
        "-i", video_mp4,
        "-i", voice_mp3,
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        "-map", "0:v:0", "-map", "1:a:0",
        "-shortest",
        out_path,
    ]
    await _run(cmd)
    return out_path


async def concat_clips(clips: list[str], out_path: str) -> str:
    """Concat clips using the concat demuxer with re-encode for safety."""
    # Build filter_complex concat to normalize
    inputs = []
    for c in clips:
        inputs += ["-i", c]
    n = len(clips)
    filt_v = "".join([f"[{i}:v:0]" for i in range(n)]) + f"concat=n={n}:v=1:a=0[v]"
    # Some clips have audio, some don't. Add anullsrc for those without.
    # Simpler approach: re-encode with concat filter using video only, audio can be added by caller.
    cmd = [
        "ffmpeg", "-y", *inputs,
        "-filter_complex", filt_v,
        "-map", "[v]",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        "-an",
        out_path,
    ]
    await _run(cmd)
    return out_path


async def compose_final(raw_mp4: str, voice_mp3: str, product: dict, scenes: list[dict], tmp_dir: str, out_path: str) -> str:
    """End-to-end composition. Returns the final polished MP4 path."""
    os.makedirs(tmp_dir, exist_ok=True)
    bg_hex = product.get("primary_color", "#0B0F1A")

    intro = os.path.join(tmp_dir, "intro.mp4")
    outro = os.path.join(tmp_dir, "outro.mp4")
    main_scaled = os.path.join(tmp_dir, "main_scaled.mp4")
    main_captioned = os.path.join(tmp_dir, "main_captioned.mp4")
    combined = os.path.join(tmp_dir, "combined_video.mp4")

    await asyncio.gather(
        make_card(product.get("product_name", "Demo"), product.get("tagline", ""), intro, INTRO_SEC, bg_hex),
        make_card(product.get("outro", "Ready to try it?"), product.get("primary_cta", "Get started"), outro, OUTRO_SEC, bg_hex),
        scale_to_canvas(raw_mp4, main_scaled),
    )
    await add_captions(main_scaled, scenes, main_captioned, bg_hex)
    await concat_clips([intro, main_captioned, outro], combined)
    await mux_voiceover(combined, voice_mp3, out_path)
    return out_path
