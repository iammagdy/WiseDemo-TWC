# Make the demo pipeline actually produce a watchable demo

Three separate things are broken. The plan fixes all three in one pass.

## What's wrong today (confirmed in the code)

1. **Nothing is ever fetched from Steel after the run.** When the session ends, `runDemoScenes` sets `recording_url` to whatever `sessionViewerUrl` the release call returned. That is a live-viewer link, not a recording — once the session is released there is nothing behind it. The demo is marked "Recording complete — replay ready" while no artifact exists. That's the blank player you see.
2. **The site map is not agentic.** `scanWebsite` only does plain HTTP fetches of public HTML. It never logs in with your stored credentials, so for a protected app it sees the marketing page or the login wall — hence generic results.
3. **The scene script is hardcoded heuristics.** `planScenes` builds a fixed goto/scroll/type/click list with guessed CSS selectors. No AI, no knowledge of the real DOM, and no check that login actually succeeded.

## What ships

### 1. Agentic recon pass (runs before any recording)
A first Steel session that acts as the scout:
- Opens the base URL, and if credentials are stored, goes to the login page, fills and submits, then **verifies** login by checking the URL changed and no password field remains.
- Walks the in-app navigation (up to ~8 links found in the live DOM after login, not from the public sitemap).
- For each page, extracts a real structural snapshot via CDP: page title, URL, headings, nav labels, button/link text with their actual CSS selectors, form fields.
- Sends that snapshot to Lovable AI (Gemini) which writes the product map: what the product does, its real features, and the key screens — saved to `projects.site_map_md` with `site_map_source = 'agent'`.
- Recon result (pages + real selectors) is stored so the recorder can use it.

### 2. AI scene planner using real selectors
`planScenes` is replaced by an AI planner that receives the recon snapshot and the user's feature prompt, and returns a strict scene list (`goto | click | type | scroll | wait` + narration), constrained to ≤69 seconds. Every selector comes from the recon DOM, so clicks land on real elements. If login is required and recon failed to log in, the demo fails immediately with a clear message instead of recording a login wall.

### 3. Real recording retrieval and playback
After the actions run and the session is released:
- Poll Steel for the actual recording: prefer the headful MP4/HLS artifact, fall back to the rrweb event stream (`/v1/sessions/{id}/events`).
- Persist the artifact to a new Cloud storage bucket `demo-recordings` (the MP4, or the rrweb events JSON), and store its public URL in `demos.recording_url`.
- A demo is only marked **ready** when an artifact exists and is non-trivial. Otherwise it goes **failed** with the real reason in `error_message`.

### 4. Playback UI
In the project studio, replace the dead iframe with:
- `<video>` when the artifact is MP4.
- An rrweb player when the artifact is an event stream.
- Live view iframe only while the session is genuinely running.
- Download button that downloads the stored artifact; for rrweb replays, the browser captures the playback to a WebM/MP4 file so there is always something to post.

## Technical notes

- New module `src/lib/steel-recon.server.ts`: login + navigation + DOM extraction over the existing CDP-over-WebSocket driver (no Playwright binary, Workers-safe).
- New module `src/lib/scene-planner.server.ts`: Lovable AI structured output for the product map and the scene list.
- `src/lib/studio.functions.ts`: `scanProjectSite` gains an agentic mode; `createDemoJob` runs recon → plan → record; `runDemoScenes` fetches and persists the artifact instead of reusing viewer URLs.
- `src/lib/steel-recorder.server.ts`: add `getSessionEvents`, `getSessionRecording` (MP4/HLS), and selector-waiting before click/type so actions don't fire on a page that hasn't loaded.
- DB migration: `demos.artifact_kind` (`mp4` | `rrweb`), `projects.recon_snapshot jsonb`; storage bucket `demo-recordings` with owner-scoped policies.
- Long runs stay chunked: recon and recording each stay inside a Worker request budget, with the client polling status between phases.

## Verification before I hand back

Run the real pipeline in a browser against your project: create a demo, confirm recon logs in with the stored credentials, confirm the product map lists real in-app features (not marketing copy), then confirm the finished demo plays in the studio and downloads as a file.
