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


async def probe_dimensions(path: str) -> tuple[int, int]:
    """Return (width, height) of the first video stream, or (0, 0)."""
    cmd = [
        "ffprobe", "-v", "quiet", "-print_format", "json",
        "-show_streams", "-select_streams", "v:0", path,
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    out, _ = await proc.communicate()
    try:
        j = json.loads(out.decode("utf-8", "ignore"))
        s = j["streams"][0]
        return int(s["width"]), int(s["height"])
    except Exception:
        return 0, 0


def _build_crop_expression(
    axis: str,
    keyframes_s: list[tuple[float, float]],
) -> str:
    """Piecewise-linear interpolation expression for ffmpeg `crop` filter time `t`.

    `axis` is used only for documentation; the caller must pass the correct
    keyframes for each axis. `keyframes_s` is `[(t_seconds, value_px), ...]`
    sorted by time. The returned string is safe for ffmpeg's expression parser.
    """
    if not keyframes_s:
        return "0"
    if len(keyframes_s) == 1:
        return f"{keyframes_s[0][1]:.1f}"

    # Build nested ifs. FFmpeg allows deep expressions but let's keep it compact.
    expr = f"{keyframes_s[-1][1]:.1f}"  # default: hold at final value
    for i in range(len(keyframes_s) - 1, 0, -1):
        t0, v0 = keyframes_s[i - 1]
        t1, v1 = keyframes_s[i]
        dt = max(1e-3, t1 - t0)
        slope = (v1 - v0) / dt
        seg = f"({v0:.1f}+{slope:.4f}*(t-{t0:.3f}))"
        expr = f"if(lt(t,{t1:.3f}),{seg},{expr})"
    # Before the first keyframe, hold at initial value
    t_first, v_first = keyframes_s[0]
    expr = f"if(lt(t,{t_first:.3f}),{v_first:.1f},{expr})"
    return expr


async def scale_with_cursor_zoom(
    input_mp4: str,
    out_path: str,
    keyframes: list[tuple[int, float, float]],
    viewport_w: int,
    viewport_h: int,
    zoom: float = 1.4,
    bg_hex: str = "#0B0F1A",
) -> str:
    """Apply cinematic cursor-follow crop+zoom, then output CANVAS_W x CANVAS_H.

    `keyframes` is a list of `(elapsed_ms, viewport_x, viewport_y)` sampled
    during the Steel tour. The function converts viewport coordinates to raw
    video pixel coordinates (adjusting for Chrome UI vertical offset), builds
    two piecewise-linear expressions for the crop `x` and `y`, then scales the
    cropped window to the canvas.
    """
    if not keyframes:
        return await scale_to_canvas(input_mp4, out_path)

    video_w, video_h = await probe_dimensions(input_mp4)
    if video_w == 0 or video_h == 0:
        return await scale_to_canvas(input_mp4, out_path)

    # Steel records the browser window (Chrome UI + page viewport). Chrome UI
    # sits above the requested viewport, so we shift cursor y down by the
    # measured overhead. Horizontal is assumed 1:1.
    scale_x = video_w / max(1, viewport_w)
    chrome_h = max(0, video_h - viewport_h)
    print(f"[composer] cursor-zoom raw video: {video_w}x{video_h} viewport={viewport_w}x{viewport_h} chrome_h={chrome_h} scale_x={scale_x:.3f}")

    # Force the crop to a 16:9 window slightly larger than the canvas so the
    # final scale step is a subtle sharpening rather than a stretch.
    crop_w = int(video_w / zoom)
    crop_h = int(crop_w * 9 / 16)
    if crop_h > video_h:
        crop_h = video_h
        crop_w = int(crop_h * 16 / 9)
    max_x = max(0, video_w - crop_w)
    max_y = max(0, video_h - crop_h)

    # Convert viewport keyframes to (t_s, crop_top_left_x, crop_top_left_y).
    kfs_x: list[tuple[float, float]] = []
    kfs_y: list[tuple[float, float]] = []
    for t_ms, vx, vy in keyframes:
        t_s = t_ms / 1000.0
        cx = vx * scale_x
        cy = vy + chrome_h  # viewport y=0 sits below Chrome UI
        crop_x = max(0.0, min(float(max_x), cx - crop_w / 2))
        crop_y = max(0.0, min(float(max_y), cy - crop_h / 2))
        kfs_x.append((t_s, crop_x))
        kfs_y.append((t_s, crop_y))

    x_expr = _build_crop_expression("x", kfs_x)
    y_expr = _build_crop_expression("y", kfs_y)

    # Escape single quotes in expressions for the ffmpeg -vf argument.
    filt = (
        f"crop=w={crop_w}:h={crop_h}:x='{x_expr}':y='{y_expr}',"
        f"scale={CANVAS_W}:{CANVAS_H}:flags=lanczos,"
        f"setsar=1,fps={FPS}"
    )
    cmd = [
        "ffmpeg", "-y", "-i", input_mp4,
        "-vf", filt,
        "-an",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
        "-pix_fmt", "yuv420p",
        out_path,
    ]
    try:
        await _run(cmd)
    except RuntimeError as e:
        print(f"[composer] cursor-zoom failed, falling back to plain scale: {e}")
        return await scale_to_canvas(input_mp4, out_path)
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


async def compose_final(
    raw_mp4: str,
    voice_mp3: str,
    product: dict,
    scenes: list[dict],
    tmp_dir: str,
    out_path: str,
    cursor_keyframes: list[tuple[int, float, float]] | None = None,
    viewport: dict | None = None,
) -> str:
    """End-to-end composition. Returns the final polished MP4 path.

    If `cursor_keyframes` are provided, the main clip uses cinematic cursor-follow
    crop+zoom; otherwise it falls back to simple letterboxed scaling.
    """
    os.makedirs(tmp_dir, exist_ok=True)
    bg_hex = product.get("primary_color", "#0B0F1A")

    intro = os.path.join(tmp_dir, "intro.mp4")
    outro = os.path.join(tmp_dir, "outro.mp4")
    main_scaled = os.path.join(tmp_dir, "main_scaled.mp4")
    main_captioned = os.path.join(tmp_dir, "main_captioned.mp4")
    combined = os.path.join(tmp_dir, "combined_video.mp4")

    if cursor_keyframes and viewport:
        main_task = scale_with_cursor_zoom(
            raw_mp4,
            main_scaled,
            keyframes=cursor_keyframes,
            viewport_w=int(viewport.get("width", 1440)),
            viewport_h=int(viewport.get("height", 900)),
            zoom=1.4,
            bg_hex=bg_hex,
        )
    else:
        main_task = scale_to_canvas(raw_mp4, main_scaled)

    await asyncio.gather(
        make_card(product.get("product_name", "Demo"), product.get("tagline", ""), intro, INTRO_SEC, bg_hex),
        make_card(product.get("outro", "Ready to try it?"), product.get("primary_cta", "Get started"), outro, OUTRO_SEC, bg_hex),
        main_task,
    )
    await add_captions(main_scaled, scenes, main_captioned, bg_hex)
    await concat_clips([intro, main_captioned, outro], combined)
    await mux_voiceover(combined, voice_mp3, out_path)
    return out_path
