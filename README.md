# Welcome to your Lovable project

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Open your project in the [Lovable editor](https://lovable.dev) and keep building.

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: connect the project to GitHub and every change made in Lovable is committed straight to your repository.
- **Full ownership**: this code is yours. Push to your repository and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Built with

- TanStack Start
- TypeScript
- React
- Tailwind CSS

## WiseDemo (this app)

Agentic demo-video studio: point it at a SaaS URL, it scans the site, plans a
shot list with AI, drives a real cloud browser (Steel.dev) through the product,
records it, and returns an MP4 you can share.

### No authentication (experimental)

Login was removed on purpose. Every visitor works in one **shared, public
workspace**. All database access happens server-side with the service-role key;
browser clients have no direct database access. Do not put real production
credentials in a publicly deployed instance.

### Routes

- `/` — landing page
- `/dashboard` — project list + create project
- `/projects/:projectId` — project studio (product map, access, demo brief, player)
- `/mcp` — open MCP server for AI agents (`list_projects`, `get_project`, `list_demos`, `update_project_map`)
- `/api/public/*` — public HTTP endpoints

### Key server modules

- `src/lib/studio.functions.ts` — server functions (projects, credentials, demo jobs, orchestration)
- `src/lib/studio-scanner.server.ts` — site scan / site-map builder
- `src/lib/steel-recon.server.ts` — agentic login + DOM recon pass
- `src/lib/scene-planner.server.ts` — AI shot-list planner
- `src/lib/recording-pass.server.ts` — fresh-session capture and duration policy
- `src/lib/steel-recorder.server.ts` — CDP driver + recording retrieval
- `src/lib/mcp/*` — MCP server and tools

### Local development

```sh
cp .env.example .env   # fill in the values
npm i
npm run dev            # http://localhost:8080
```

### Recording pipeline

The recording state machine is:

```text
pending -> scanning -> planning -> recording -> rendering -> ready
                                                    \-> failed
```

`ready` is reserved for a validated recording that has been uploaded to the
private `demo-recordings` bucket and successfully fetched through a short-lived
signed URL. A Steel live viewer or replay URL never makes a demo ready.

Reconnaissance and scene planning happen before the deliverable capture. The
recon browser is explicitly released, then WiseDemo opens a fresh recording
session, signs in again when stored access exists, and executes only the curated
scene plan. The capture targets 50 seconds, must finalize between 45 and 69
seconds, and fails validation outside that range.

After the browser actions finish, WiseDemo explicitly releases the Steel
session and polls the documented `GET /v1/sessions/{sessionId}/hls` endpoint.
Transient post-release `404` responses are treated as recording-not-ready. Once
the playlist contains `#EXT-X-ENDLIST`, WiseDemo resolves relative
`#EXT-X-MAP` and segment URLs, downloads every part with server-side Steel
authentication, and validates the ISO-BMFF layout (`ftyp`/`moov` followed by
complete `moof`/`mdat` fragments). Missing or invalid media fails the artifact;
segments are never silently skipped.

Steel currently emits a standards-compliant fragmented MP4, so the complete,
validated initialization and media fragments are stored as `video/mp4`. This is
not blind byte concatenation: if Steel changes the playlist or container shape,
validation fails before upload. The Cloudflare Workers runtime cannot execute a
native FFmpeg process; a future requirement for a flat, non-fragmented MP4 must
use a durable Node/media worker with FFmpeg rather than browser-side WASM.

The database stores `recording_object_path`, not an expiring signed URL. The
stable `/api/public/demo-recordings/:demoId` route creates a fresh five-minute
signed URL for playback, and `?download=1` supplies the download response.

Apply this migration before deploying the stabilized pipeline:

```text
supabase/migrations/20260731204500_recording_pipeline_stabilization.sql
```

It adds execution/finalization claim metadata, durable recording metadata, and
creates the private `demo-recordings` bucket if it does not already exist. It
does not delete or rewrite existing demos.

No new environment variables are required. `STEEL_API_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `WISEDEMO_CREDS_KEY` remain server-only.

### Recording verification

```sh
npm test
npm run build
npm run lint
node --env-file=.env scripts/inspect-steel-hls.mjs
```

The Steel probe prints only sanitized HTTP/container evidence. It does not print
the API key, session ID, or authenticated media URLs.

### Long-running execution limitation

Execution and finalization use database claims, deterministic uploads, bounded
retries, and stale-lock recovery. The studio can safely resume an interrupted
request after refresh while the Steel session remains alive. This is not a
durable background queue: closing the only client before execution finishes can
still leave work paused until the studio is reopened, and a sufficiently old
Steel session may then fail. Production deployments that must finish with no
open client need a durable queue/worker that invokes the same idempotent server
pipeline; a browser fire-and-forget request must not be treated as that worker.

### Deploying to Vercel

The build uses Nitro (Cloudflare Workers preset by default). For Vercel, set the
Nitro preset to `vercel` in `vite.config.ts`:

```ts
export default defineConfig({
  tanstackStart: { server: { entry: "server" } },
  nitro: { preset: "vercel" },
  vite: { plugins: [mcpPlugin()] },
});
```

Then add every variable from `.env.example` in Vercel → Project → Settings →
Environment Variables and deploy. Note: the recording pipeline needs long-lived
requests — if a run times out on serverless, move `runDemoScenes` to a queue or
a long-running worker.
