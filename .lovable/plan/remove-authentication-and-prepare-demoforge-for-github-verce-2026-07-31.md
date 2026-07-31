# Remove authentication and prepare WiseDemo for GitHub / Vercel / Codex

Goal: anyone who opens the app can use every screen — no sign-in, no accounts — and the repo is ready to be edited and deployed outside Lovable.

## What changes for the user

- No login page, no Google sign-in, no gate. Opening the app goes straight to the studio.
- Landing page keeps its marketing content, but the CTA goes to the dashboard instead of sign-up.
- All projects and demos live in one shared, public workspace. Everyone sees the same projects.
- Everything else (site scan, credential storage, Steel recording, demo playback/download) keeps working.

Note: this is a deliberate trade-off for the experimental stage — the stored product credentials and all demos become visible to any visitor of the deployed URL. Keep the deployment private/unlisted until auth comes back.

## Frontend changes

- Delete `src/routes/auth.tsx`, `src/routes/_authenticated/route.tsx`, and the OAuth consent route `src/routes/[.]lovable.oauth.consent.tsx`.
- Move `_authenticated/dashboard.tsx` -> `src/routes/dashboard.tsx` and `_authenticated/projects.$projectId.tsx` -> `src/routes/projects.$projectId.tsx` (URLs stay `/dashboard` and `/projects/:id`).
- Strip sign-in/sign-out/session UI from the landing page, dashboard header, and project studio; remove `supabase.auth` calls and the root `onAuthStateChange` subscriber.
- Remove `attachSupabaseAuth` from `src/start.ts` (keep the error and CSRF middleware).

## Backend changes

- `src/lib/studio.functions.ts`: drop `.middleware([requireSupabaseAuth])` from every server function. Each handler instead uses the service-role client loaded inside the handler, and a single constant workspace owner id (`SHARED_WORKSPACE_OWNER`) replacing `context.userId` in all inserts and `.eq("owner_id", ...)` filters.
- Database migration:
  - drop the `owner_id -> auth.users` foreign keys on `projects`, `demos`, `demo_events`, `project_credentials` so the shared id needs no auth user;
  - keep RLS enabled with no public policies (server functions use the service role, so the tables stay unreachable from the browser).
- MCP: the `/mcp` server currently authorizes callers through Cloud OAuth as a signed-in user. With auth gone it will serve the shared workspace without OAuth. The OAuth consent route and protected-resource metadata are removed with it.

## Repo prep for GitHub / Vercel / Codex

- Add `.env.example` listing the required variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `STEEL_API_KEY`, `DEMOFORGE_CREDS_KEY`, `LOVABLE_API_KEY` (used for the AI scene planner), `FIRECRAWL_API_KEY` (optional).
- Rewrite `README.md` as a real setup/run/deploy guide (install, dev, env vars, pipeline overview, file map).
- Vercel note: the build currently targets a Cloudflare Worker runtime via the Lovable Vite config. The plan documents the one change needed to deploy on Vercel (switching the Nitro/Vite server preset to `vercel`) in the README and handover prompt, without changing the config here so the Lovable preview keeps working.

## Handover prompt

After the work is done I'll paste a ready-to-use Codex handover prompt in chat: architecture summary, file map, env vars, the known gap (the Steel CDP drive step stalling at 55% on the local runtime), and the first tasks to pick up (re-adding auth, Vercel preset, finishing the recording loop).
