# DemoForge — Agentic Demo Video SaaS (MVP)

Turn a founder's SaaS URL + credentials into a real, polished ≤60-second product demo video, autonomously.

## What v1 does end-to-end

1. Founder signs up, creates a **Project** (their product).
2. They provide the site URL and, optionally, **encrypted login credentials** (or a session cookie / magic link).
3. **Site discovery**: either the built-in scanner (Firecrawl) crawls the app and returns a site map + AI description, OR the founder pastes a Markdown site-map they generated elsewhere (we give them the exact prompt to copy).
4. Founder picks a **feature/page** to demo and writes 1–2 lines of intent ("Show how a user creates a workflow and shares it").
5. Our AI **scene planner** converts intent + site map into a step-by-step browser script (goto, click, type, wait, highlight).
6. A **cloud browser session** launches, logs in with the encrypted creds, executes the script, and records the full session as MP4. The user sees live **progress steps** (not a live video stream in v1).
7. **Post-render pipeline** trims to ≤60s, adds cursor highlights, zoom-to-click, captions, intro/outro card, and optional music.
8. Founder previews the MP4, can re-generate scenes, then downloads or shares (X, LinkedIn, TikTok share URLs).
9. Usage is metered against a **Stripe subscription** (free tier: 2 demos/mo, paid tiers: more).

## Recommended recording engine

**Browserbase** (managed cloud Chromium with native session recording + stealth). Reasons vs alternatives:
- Cloudflare Workers (our server runtime) cannot run Playwright/Chromium/FFmpeg natively — we must offload.
- Browserbase returns an MP4 of the session out of the box, handles proxies/captcha better than self-hosted, has a Node SDK we call from a server route, and supports future live-view if we want it later.
- Self-hosted Playwright is possible but needs a separate always-on VM + storage + queue infra — too heavy for MVP.
- Client-side screen recording is blocked by X-Frame-Options on most SaaS.

**Post-processing (captions, zoom, trim, intro/outro)**: **Creatomate** template API (JSON → rendered MP4). Avoids running FFmpeg in the Worker. Alternative: Shotstack. Both are add_secret API keys.

## Tech stack

- **Frontend**: TanStack Start + Tailwind + shadcn/ui (existing template).
- **Backend**: Lovable Cloud (Supabase) — auth, Postgres, Storage (for MP4s), RLS.
- **Auth**: email/password + Google sign-in via Lovable broker.
- **AI**: Lovable AI Gateway (Gemini for scene planning + caption/script writing).
- **Site scanning**: Firecrawl connector (`scrape`, `map`, `summary`).
- **Recording**: Browserbase (API key via `add_secret`).
- **Video render**: Creatomate (API key via `add_secret`).
- **Payments**: Stripe (subscriptions).
- **Secrets encryption**: AES-256-GCM with an app-managed key (`generate_secret DEMOFORGE_CREDS_KEY`) for user-supplied login creds stored in Postgres.

## Data model (Lovable Cloud)

- `profiles` — user profile, plan tier, credit balance.
- `projects` — one per SaaS product: name, base_url, description, site_map_md (text), site_map_source ('firecrawl'|'manual'), created_at.
- `project_credentials` — encrypted creds/cookie per project (nullable). Ciphertext + IV + tag columns. RLS: owner-only.
- `demos` — one per generated video: project_id, feature_prompt, scene_script_json, status (pending|scanning|planning|recording|rendering|ready|failed), progress_step, mp4_url (Supabase Storage), thumbnail_url, duration_s, share_slug, created_at.
- `demo_events` — append-only log per demo (step name, message, timestamp) for the live progress UI.
- `subscriptions` — Stripe customer/subscription state, monthly demo quota, usage counter.
- `user_roles` (+ `has_role()` per project convention) for future admin.

All tables get proper GRANTs, RLS enabled, owner-scoped policies via `auth.uid()`.

## Server surface

- `createServerFn`:
  - `createProject`, `updateProject`, `saveEncryptedCredentials`, `deleteCredentials`
  - `scanSite` → calls Firecrawl gateway, saves site_map_md
  - `getFirecrawlPromptCopy` → returns the exact prompt for the user's manual/ChatGPT path
  - `planDemoScenes` → Lovable AI structured output → scene_script_json
  - `startDemoRun` → inserts `demos` row, kicks off recording job
  - `getDemoStatus`, `listDemos`, `deleteDemo`
  - `createStripeCheckout`, `getBillingPortalUrl`
- Server routes (raw HTTP):
  - `/api/public/webhooks/stripe` — subscription state sync (HMAC verified)
  - `/api/public/webhooks/browserbase` — session-complete callback → triggers Creatomate render
  - `/api/public/webhooks/creatomate` — render-complete → uploads MP4 to Storage, marks demo ready
  - `/api/demo/:id/stream-progress` — SSE endpoint the demo page subscribes to for live step updates

## Routes (TanStack)

- `/` — marketing landing (hero, how-it-works, sample demo, pricing, CTA)
- `/auth` — sign in / up (email + Google)
- `/pricing`
- `/_authenticated/dashboard` — list of projects and recent demos
- `/_authenticated/projects/new` — create project wizard (URL → scan → confirm site map)
- `/_authenticated/projects/$projectId` — project detail, credentials manager, site map viewer, "New demo" button
- `/_authenticated/projects/$projectId/demos/new` — feature prompt + scene preview + launch
- `/_authenticated/demos/$demoId` — live progress + final video player + share/download
- `/_authenticated/billing` — plan + Stripe portal link
- `/share/$slug` — public shareable demo page with og:image = thumbnail, og:video

## Credentials handling (security)

- User picks: **Public pages only** (no creds), **paste session cookie**, or **email/password**.
- Values go into `saveEncryptedCredentials` server fn → AES-256-GCM encrypted with `DEMOFORGE_CREDS_KEY` (auto-generated) → stored as ciphertext columns.
- Decryption happens only inside the recording server route right before the Browserbase session, never returned to the client.
- Owner-only RLS. Service-role client used for decrypt path.
- UI clearly explains: dedicated test account recommended; can be deleted anytime.

## User-facing progress states (no live video v1)

`Scanning site → Planning scenes → Launching browser → Signing in → Recording (step 3/8: "Click New Workflow") → Uploading recording → Rendering video → Done`. Streamed via SSE.

## What the user sees (key screens)

1. **Landing** — bold hero: "Turn your SaaS into a 60-second demo. No editors, no takes." Sample video, 3-step how-it-works, pricing.
2. **New project wizard** — URL input → "Scan with AI" button (Firecrawl) OR "I'll paste my own site map" (shows copyable prompt). Preview map, save.
3. **New demo** — pick page/feature, write 1-line intent, AI shows planned scenes as an editable list, "Record demo" button.
4. **Demo page** — big progress tracker with animated current step, then MP4 player, share buttons, regenerate button.

## Design direction

Modern SaaS-tool aesthetic: dark surface, high-contrast typography, one bold accent color, tight cards, tasteful motion. I'll generate 3 rendered directions before building the UI so you can pick the vibe.

## Out of scope for v1 (call out explicitly)

- **Live browser stream** to the user during recording (we deliver progress + final MP4).
- Team accounts / multi-seat.
- Custom video templates beyond 2–3 presets.
- Voiceover / AI narration (captions only in v1).
- Scheduled/recurring demo re-renders.

## Build phases

1. **Enable Lovable Cloud**, provision auth, base schema + RLS + GRANTs.
2. **Design directions** (3 prototypes) → user picks one → apply to landing + app shell.
3. **Landing + auth + dashboard shell**.
4. **Projects + site scanning** (Firecrawl connector wired, manual paste flow).
5. **Encrypted credentials store**.
6. **Scene planner** (Lovable AI structured output).
7. **Browserbase recording server route + webhook + SSE progress**.
8. **Creatomate render webhook + Supabase Storage upload**.
9. **Demo viewer + share pages + og:image/og:video**.
10. **Stripe subscriptions + quota enforcement**.
11. **Polish, empty states, error boundaries, publish**.

## Things you'll need to provide when I start

- Approve the recording engine choice (**Browserbase**) — I'll open the secret form for `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID`.
- Approve **Creatomate** for video post-processing — I'll open the secret form for `CREATEOMATE_API_KEY` and one template ID.
- Connect **Firecrawl** via the connector picker when we hit that step.
- Decide pricing (I'll suggest Free / $29 / $79 tiers; we can tweak).
- Product name (default: **DemoForge** — happy to change).

Reply "looks good" (or with changes) and I'll switch to build mode, start with Lovable Cloud + design directions.
