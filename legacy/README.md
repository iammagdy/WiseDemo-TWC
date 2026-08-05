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

Generic product-video studio: upload a real MP4, shape its crop, framing,
message, and focus beats, then render a downloadable MP4. The default product
does not request credentials, mutate third-party products, or require a cloud
browser.

The earlier autonomous browser capture path remains an experimental integration
behind `WISEDEMO_EXPERIMENTAL_AUTONOMOUS_CAPTURE=true`; it is off by default.

### No authentication (experimental)

Login was removed on purpose. Every visitor works in one **shared, public
workspace**. All Appwrite TablesDB and Storage access happens through the
Appwrite Node Server SDK or the server-side recording proxy; browser clients
have no direct Appwrite access. Do not put real production
credentials in a publicly deployed instance.

### Routes

- `/` — landing page
- `/dashboard` — project list + create project
- `/projects/:projectId` — project studio (product map, access, demo brief, player)
- `/projects/:projectId/demos/:demoId/editor` — non-destructive composition editor
- `/mcp` — open MCP server for AI agents (`list_projects`, `get_project`, `list_demos`, `update_project_map`)
- `/api/public/*` — public HTTP endpoints

### Key server modules

- `src/lib/studio.functions.ts` — server functions (projects, credentials, demo jobs, orchestration)
- `src/lib/studio-scanner.server.ts` — site scan / site-map builder
- `src/lib/steel-recon.server.ts` — agentic login + DOM recon pass
- `src/lib/scene-planner.server.ts` — AI shot-list planner
- `src/lib/recording-pass.server.ts` — fresh-session capture and duration policy
- `src/lib/steel-recorder.server.ts` — CDP driver + recording retrieval
- `src/composition/*` — versioned composition model, frame registry, templates, and shared Remotion scene
- `src/lib/composition.functions.ts` — composition persistence, AI styling, export lifecycle, and retries
- `src/lib/composition-renderer.server.ts` — isolated server render worker and temporary artifact recovery
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
private Appwrite `demo-recordings` bucket and successfully fetched through the
server-side Range proxy. A Steel live viewer or replay URL never makes a demo
ready.

Reconnaissance and scene planning happen before the deliverable capture. The
recon browser is explicitly released, then WiseDemo opens a fresh recording
session, signs in again when stored access exists, and executes only the curated
scene plan. The capture targets 50 seconds, must finalize between 45 and 69
seconds, and fails validation outside that range.

Each demo stores a recording locale: English (the default), Arabic, or
auto-detect. For an explicit locale, WiseDemo enables the Network and Emulation
CDP domains and applies the locale, `Accept-Language`, user-agent language, and
request headers before the first target navigation in both recon and final
sessions. After sign-in it checks the document language, browser language,
visible navigation, locale cookies/storage, URL, and real application language
controls. The generic selector flow runs first; a verified site adapter may
update that application's own language preference when browser locale alone is
not authoritative. An explicit locale that cannot be verified fails before the
deliverable recording starts. Diagnostics never include credentials, tokens,
account identifiers, or sensitive page content.

After the browser actions finish, WiseDemo explicitly releases the Steel
session and polls the documented `GET /v1/sessions/{sessionId}/hls` endpoint.
Transient post-release `404` responses are treated as recording-not-ready. Once
the playlist contains `#EXT-X-ENDLIST`, WiseDemo resolves relative
`#EXT-X-MAP` and segment URLs, downloads every part with server-side Steel
authentication, and validates the ISO-BMFF layout (`ftyp`/`moov` followed by
complete `moof`/`mdat` fragments). Missing or invalid media fails the artifact;
segments are never silently skipped.

Steel currently emits standards-compliant fragmented MP4 media. After strict
fragment validation, WiseDemo remuxes its samples in pure JavaScript into a
progressive `ftyp`/`moov`/`mdat` MP4 with finalized duration, sample, sync, and
chunk-offset tables. The stored download therefore exposes its complete
timeline and seek range before playback without requiring native FFmpeg. If
Steel changes the playlist or container shape, validation or remuxing fails
before upload; fragments are never stored by blind byte concatenation.

The database stores the deterministic Appwrite `recording_file_id`, not an API
key or expiring URL. The stable `/api/public/demo-recordings/:demoId` route
proxies the private Appwrite file, preserves byte-range responses for seeking,
and `?download=1` supplies the download response. Appwrite credentials never
reach the browser.

### Non-destructive composition editor

A ready demo's Appwrite MP4 is immutable source media. The editor stores a
versioned composition JSON document that references that raw file and describes
canvas size, background, generic frame asset and exact screen region, crop/fit,
zoom and motion events, captions, branding, intro/outro cards, audio, and export
quality. Selecting a template forks a new composition rather than overwriting a
previous design. Multiple exports can therefore reuse one Steel recording
without creating a new browser session.

The raw Steel file remains unchanged even when it contains native Chrome UI.
Before composition, WiseDemo combines the recorded MP4 dimensions with runtime
browser metrics (`innerWidth`, `innerHeight`, `outerWidth`, `outerHeight`,
window position, visual viewport, and device pixel ratio) to store a separate
`sourceViewport` rectangle. The shared preview/render scene crops to that page
viewport before fit, page-coordinate zoom transforms, masking, and device-frame
placement. Source crop top/right/bottom/left controls provide small per-demo
corrections and can be reset to the detected viewport. Use `contain` when the
complete page must remain visible in a device screen whose aspect ratio differs
from the browser content viewport.

Preview and export use the same React `CompositionScene`. The browser player
uses native HTML video decoding for responsive editing, while the server worker
uses Remotion's deterministic off-thread decoder and H.264/YUV420p renderer.
The server downloads the private raw Appwrite file into an isolated
`.codex-tmp/composition-renders/<exportId>` job, bundles only the original
assets under `public/frames`, renders the MP4, uploads it under the export ID,
verifies its stored size, and then removes the exact job directory. If Appwrite
is temporarily unavailable after rendering, the final bytes remain in the
ignored `.codex-tmp/composition-artifacts` recovery cache and a retry resumes
the upload without rerendering or rerunning Steel. A confirmed ready export
clears that cache.

The private final file is exposed only through
`/api/public/composition-exports/:exportId`, which supports Range requests,
seeking, refresh recovery, sharing, and `?download=1`. Remotion versions are
pinned exactly and aligned. A production render worker needs a writable
temporary filesystem, Node.js, the Remotion headless Chrome binary, and enough
worker time for full-resolution frame rendering.

### Appwrite resources

WiseDemo uses only the Appwrite 27 TablesDB/Rows model; it does not mix legacy
Collections/Documents calls into the runtime. The repeatable bootstrap creates
or verifies these private, server-only resources:

- `projects` table
- `project_credentials` table (credential ciphertext remains AES-256-GCM
  encrypted with `WISEDEMO_CREDS_KEY`; the ciphertext column also enables
  Appwrite encryption at rest)
- `demos` table
- `demo_events` table
- `compositions` table
- `composition_exports` table
- private `demo-recordings` Storage bucket (MP4, 500 MiB maximum)

Copy `.env.example`, create a temporary Appwrite setup API key, and run:

```sh
npm run appwrite:bootstrap
```

The script loads `.env` first and then `.env.local`, so local server secrets can
remain in the ignored `.env.local` file and override non-secret local defaults.

`npm run dev` also loads these ignored server environment files before Vite
starts. This is required for `WISEDEMO_CREDS_KEY` and the other server-only
credentials; they are not exposed through Vite's browser environment.

The resource-ID variables are configurable; when omitted, both runtime and
bootstrap use the IDs shown in `.env.example`.

The temporary `APPWRITE_SETUP_API_KEY` needs exactly:

- `databases.read`, `databases.write`
- `tables.read`, `tables.write`
- `columns.read`, `columns.write`
- `indexes.read`, `indexes.write`
- `buckets.read`, `buckets.write`

Revoke that key immediately after bootstrap. The long-lived
`APPWRITE_API_KEY` used by WiseDemo needs only:

- `rows.read`, `rows.write`
- `files.read`, `files.write`

All four table permission arrays and the bucket permission array are empty,
row/file security is disabled, and no Appwrite client SDK is initialized in the
browser. The Server SDK API key bypasses those resource permissions. Public
workspace behavior is provided only by WiseDemo's existing server functions,
MCP tools, and public media route; no user accounts or authentication are added.

Set these server-side runtime variables before deploying:

```text
APPWRITE_ENDPOINT
APPWRITE_PROJECT_ID
APPWRITE_API_KEY
APPWRITE_DATABASE_ID
APPWRITE_PROJECTS_COLLECTION_ID
APPWRITE_CREDENTIALS_COLLECTION_ID
APPWRITE_DEMOS_COLLECTION_ID
APPWRITE_DEMO_EVENTS_COLLECTION_ID
APPWRITE_COMPOSITIONS_COLLECTION_ID
APPWRITE_COMPOSITION_EXPORTS_COLLECTION_ID
APPWRITE_RECORDINGS_BUCKET_ID
WISEDEMO_CREDS_KEY
STEEL_API_KEY
LOVABLE_API_KEY
```

`APPWRITE_API_KEY`, `WISEDEMO_CREDS_KEY`, `STEEL_API_KEY`, and
`LOVABLE_API_KEY` must remain server-only.

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

Execution and finalization use transactional Appwrite row claims,
deterministic uploads, bounded retries, and stale-lock recovery. The studio can
safely resume an interrupted
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
