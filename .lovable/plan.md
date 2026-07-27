
# Make DemoForge actually record real demos

Replace the current canvas-based fake renderer with a real cloud browser (Steel.dev) that logs into the user's SaaS, clicks through it, and returns a genuine MP4. Layer an AI-written scene script and Lovable AI TTS narration on top.

## What you get after this ships

1. You paste a URL (and optional credentials).
2. Firecrawl scans the site (already working).
3. Gemini writes a step-by-step scene script (real selectors, real actions).
4. **Steel.dev spins up a real Chromium in the cloud**, executes the script, records the session as MP4.
5. Lovable AI TTS generates voiceover from the script narration.
6. Your browser muxes the recorded MP4 + TTS audio + caption overlay into the final demo (client-side, free).
7. Playable + downloadable in the dashboard, ≤69s.

No fake canvas frames. No blank videos. Real clicks on the real site.

## What you need to do once

- Sign up at **steel.dev** (free — 500 browser-minutes/month, no card).
- Copy the API key from Steel dashboard.
- When I ask, paste it into the secret prompt I'll open. That's it.

## Scope this turn: recording pipeline only

Voiceover + captions overlay ship next turn. This turn ends when you can click "Generate demo" and get back a real MP4 of your site being driven.

## Build steps

1. **Request the Steel API key** via `add_secret` (`STEEL_API_KEY`).
2. **New server module** `src/lib/steel-recorder.server.ts`:
   - `createSteelSession()` → POST `https://api.steel.dev/v1/sessions` with `record_session: true`.
   - `executeScenes(sessionId, scenes, credentials)` → uses Steel's CDP WebSocket endpoint via `playwright-core`'s `chromium.connectOverCDP` (works in Workers because it's pure WS, no native binary).
   - `stopAndFetchRecording(sessionId)` → GET the session's `recording_url` (MP4 hosted by Steel).
3. **New server module** `src/lib/scene-planner.server.ts`:
   - Calls Lovable AI (`google/gemini-3.6-flash`) with the Firecrawl site map + user's feature prompt.
   - Uses `Output.object` to return a strict scene list: `{ action: 'goto'|'click'|'type'|'scroll'|'wait', selector?, text?, narration }`.
   - Prompt-limited to fit 69 seconds (max ~8 scenes, ~8s each).
4. **Rewrite** `createDemoJob` in `src/lib/studio.functions.ts`:
   - Decrypt stored credentials.
   - Call scene-planner → save `scene_script` on the `demos` row.
   - Kick off recording as a background task (server function returns immediately with `status: 'recording'`).
   - A polling server function `getDemoStatus(demoId)` returns Steel session state + `recording_url` when ready.
5. **Update** `src/routes/_authenticated/projects.$projectId.tsx`:
   - Delete the canvas `renderDemoVideo` code (~200 lines gone).
   - Replace `DemoRow` with a `<video src={demo.recording_url}>` + status polling every 3s.
   - Download button = anchor `href={recording_url} download`.
6. **DB migration**: add `demos.recording_url text`, `demos.steel_session_id text`, `demos.error_message text`.
7. **Verify with Playwright**: create a project against `https://example.com`, trigger a demo, poll until Steel returns the MP4, confirm the `<video>` plays.

## Technical notes

- Steel exposes CDP over WSS: `wss://connect.steel.dev?sessionId=...&apiKey=...`. `playwright-core` connects to that from the Worker with no filesystem or native deps — this is the pattern Steel documents.
- Recording is server-side on Steel's infra, so Cloudflare Workers file/FFmpeg limits don't apply.
- Long-running (>30s) recording is handled by returning early and polling; Workers can't hold a connection for the full 69s render.
- If `STEEL_API_KEY` is missing, `createDemoJob` returns a clear "add your Steel key" error instead of falling back to fake frames.

## What's explicitly NOT in this turn

- AI voiceover muxing (next turn — needs the recorded MP4 first).
- Caption overlay burn-in.
- 9:16 aspect ratio export.
- Multiple takes / retries.
- Live browser view iframe (Steel supports it; deferred to keep this focused).

Approve and I'll switch to build mode, request your Steel API key first, then implement.
