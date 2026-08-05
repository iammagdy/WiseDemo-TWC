# Context.dev and Gemini Director Architecture

## Audit and integration points

WiseDemo already stores projects, encrypted credentials, demos, events, compositions, exports, V2 intelligence, storyboards, captures, and quality reviews in Appwrite TablesDB. Recordings and evidence live in private Appwrite Storage and are served through range-capable server routes. `studio.functions.ts` owns the project/demo lifecycle; `steel-recorder.server.ts` owns CDP actions, locale verification, HLS/MP4 validation, and release cleanup; `recording-pass.server.ts` provides safe recording budgets. Remotion remains the deterministic renderer, with editable composition data separated from immutable raw recordings.

The director path layers on top of those boundaries. Context.dev receives only a validated public URL. Gemini receives sanitized public intelligence, a boolean indicating whether credentials exist, and after capture only semantic telemetry. Credentials stay in the encrypted Appwrite-to-Steel login path.

## Directed lifecycle

`Context public intelligence -> Gemini Creative Brief -> one Steel session -> targeted DOM preflight -> fictional demo preparation -> take markers -> final take telemetry -> automatic Remotion compilation -> deterministic QA -> Gemini Files review -> up to two render-only revisions`.

The raw recording remains immutable. The compiler trims the preflight using single-clock take markers and uses captured click boxes for deterministic zooms. Gemini never supplies selectors, CDP commands, JSX, credentials, or unsourced URLs.

## Provider boundaries

`src/integrations/context` uses `brand.retrieve`, `web.extract`, `web.extractStyleguide`, `web.screenshot`, and a single `web.webCrawlMd` fallback. Public intelligence is Zod-validated and retains source evidence.

`src/integrations/gemini` uses the direct Interactions API for strict JSON planning/review and the Files API only for server-side final-MP4 review. Uploaded Gemini files are deleted in `finally`. Missing/invalid provider output is a failure or `unavailable` status, never a fabricated score.

## Persistence

`director_artifacts` is provisioned by `scripts/bootstrap-appwrite.mjs`. It stores versioned public intelligence, brand/style cache, creative briefs, capture plans/telemetry, deterministic QA, Gemini reviews, provider/model metadata, expiry, revision, and sanitized failure state. Public intelligence uses a seven-day cache key; brand/style artifacts may use a thirty-day cache key.
