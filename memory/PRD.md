# WiseDemo v2 — PRD

## Problem
Users want to give a product URL (or upload video) and get a professional marketing demo video autonomously — no interactive editor, no manual takes.

## Architecture (current)
- Backend: FastAPI (`/app/backend/`) at port 8001, MongoDB via motor
- Frontend: React 19 (`/app/frontend/`) at port 3000, CRA + axios + lucide
- Legacy Lovable/TanStack codebase moved to `/app/legacy/` (not used)

## Video pipeline
1. Scrape URL → snapshot (title, meta, headings, CTAs, logo)
2. Gemini 2.5-flash → analyze product (name, tagline, features, colors, vibe)
3. Gemini 2.5-flash → script demo (actions for Steel, scene captions + narration)
4. Steel Browser + Playwright over CDP → 25fps auto-recorded tour (safe: goto/scroll/hover only)
5. Fetch HLS from Steel with `steel-api-key` header, remux/re-encode to MP4 via ffmpeg
6. OpenAI TTS (via Emergent Universal Key, voice: `onyx`, model: `tts-1-hd`) → narration MP3
7. Composer (ffmpeg): 1920x1080 canvas + intro card + captioned main + outro card + voiceover

## Integrations
- STEEL_API_KEY (user provided)
- GEMINI_API_KEY (user provided)
- EMERGENT_LLM_KEY (Emergent Universal Key — for OpenAI TTS only)
- MongoDB local (jobs collection)

## API surface
- `GET  /api/health`
- `POST /api/jobs` `{url}` → create job, fire background pipeline
- `GET  /api/jobs` → list
- `GET  /api/jobs/{id}` → status/progress/product/video_url
- `GET  /api/jobs/{id}/video?download=0|1` → stream MP4

## What's implemented (Jan 2026)
- End-to-end pipeline end-to-end (Linear.app tested: 42.7s, 1080p, ~90s wall time)
- Cinematic landing page (Fraunces serif hero, film-strip decorations, marquee ticker)
- Progress screen with 5-stage cinematic slate
- Ready screen with autoplay preview + MP4 download

## Backlog (P1/P2)
- Voice picker (nova/onyx/sage) + Arabic voice
- Background music bed (royalty-free ambient)
- Cursor-follow zoom on main clip
- Video re-review with Gemini for quality gating
- Multiple demo takes / gallery
- Payment / usage quotas
- Sharing links (public preview URLs)

