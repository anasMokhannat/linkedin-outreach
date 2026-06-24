# LinkedIn Personalized Outreach Platform

A multi-tenant Next.js app where each user connects their LinkedIn session, syncs
1st-degree connections, filters them into leads, enriches selected leads, generates
personalized messages, and **explicitly approves then sends** them — one at a time,
throttled to stay within LinkedIn's limits.

> ⚠️ This automates actions on LinkedIn using the user's own session and operates
> against LinkedIn's Terms of Service; it carries account-restriction risk. Sending
> limits are conservative by default. Surface this to users during onboarding.

## Stack

Next.js (App Router, TS) · Supabase (Postgres + Auth + Vault) · Apify · OpenRouter ·
Vercel. No Python in the app.

## The three gates (core flow)

1. **Request** (Gate 1) — generate a draft via OpenRouter → `messages.status = draft`.
2. **Approve** (Gate 2) — review/edit/approve. Approval alone queues nothing.
3. **Send** (Gate 3) — explicit per-message Send → `queued` + one `send_queue` row.
   Blocked with a "continue tomorrow" notice once the daily cap is reached.

Delivery is paced by a Vercel Cron job with jitter inside working hours. The cap is
enforced **at send time**, so the queue never exceeds it.

`draft → approved → queued → sent` (or `failed`); `draft/approved → rejected`. The
`approved → queued` transition happens **only** on the explicit Send click.

## LinkedIn provider abstraction

Connection-fetch and DM-send go through a swappable provider (`lib/providers/`),
selected by the `LINKEDIN_PROVIDER` env var:

- **`apify`** (default) — cookie-based Apify actors. Fully implemented. Async:
  runs start and a webhook finalizes them.
- **`linkedin-api`** — official LinkedIn API. **Stubbed**: it throws a clear
  `ProviderNotImplementedError` because listing connections and sending member
  DMs are **not available to standard apps** — they require LinkedIn Partner
  Program access (Sales Navigator / Marketing Developer Platform). Implement
  `LinkedInApiProvider.fetchConnections` / `.sendMessage` against your granted
  endpoints once that access is confirmed. The interface already supports a
  synchronous (inline REST) execution model for this case.

Everything else (Vault, caps, gates, cron, RLS) is provider-agnostic.

## Security model (non-negotiable)

- The `li_at` session cookie is the most sensitive asset. It is encrypted into
  **Supabase Vault** (via service-role RPCs), **never** stored in a plain column,
  **never** returned to the browser, **never** logged. It is decrypted server-side
  just-in-time before a cookie-based actor call.
- The cookie is used for **only two** actions: fetching connections and sending DMs.
  All enrichment uses **cookieless** public-data actors (zero account risk).
- The Supabase **service role key** is server-only; background jobs that bypass RLS
  (cron, webhook) filter by `user_id` explicitly in code.
- **RLS** is enabled on every table (`auth.uid() = user_id`).
- Actor IDs are **config** (env vars), never hardcoded.
- `/api/cron/*` is protected by `CRON_SECRET`; the Apify webhook verifies a shared
  secret on every call.

## Project layout

```
/app
  /(auth)/login              # LinkedIn OIDC sign-in
  /auth/callback             # OAuth code exchange
  /(app)                     # authenticated shell (nav + guard)
    /dashboard /connections /leads /messages /settings
  /api/...                   # see "API surface" below
/extension                   # browser extension (li_at capture) + manual paste fallback
/lib                         # env, supabase clients, apify, openrouter, vault, caps, ...
/supabase/migrations         # schema + RLS + triggers + Vault/usage RPCs
vercel.json                  # cron schedule
```

## API surface

```
POST   /api/linkedin/connect       store + validate encrypted cookie (DELETE to disconnect)
POST   /api/sync/connections       start connections actor -> transient staging
GET    /api/connections            Tier-1 filtered staging view (reads Apify dataset)
POST   /api/leads/select           persist selected leads (first persistence point)
GET    /api/leads                  list leads + Tier-2 filters
DELETE /api/leads/:id              delete a lead (cascades enrichment + messages)
POST   /api/leads/:id/enrich       cookieless profile+posts+company enrichment
POST   /api/messages/generate      Gate 1: OpenRouter draft
GET    /api/messages               list messages + daily cap status
PATCH  /api/messages/:id           Gate 2: edit / approve / reject
POST   /api/messages/:id/send      Gate 3: one message -> queued (cap-checked, 429 if reached)
GET    /api/cron/process-queue     cron-only: throttled delivery (CRON_SECRET)
POST   /api/webhooks/apify         actor completion handler (secret-verified)
GET    /api/settings  PATCH        per-user config (caps/hours/value-prop/model)
GET    /api/log                    recent audit events
POST   /api/data                   retention: purge raw enrichment / delete all
```

## Local setup

1. **Install deps**

   ```bash
   npm install
   ```

2. **Create a Supabase project**, then enable:
   - **Auth → LinkedIn (OIDC)** provider, with redirect `http://localhost:3000/auth/callback`
     (and your production `…/auth/callback`).
   - **Vault** (Database → Extensions / Vault).

3. **Run migrations** (Supabase CLI):

   ```bash
   supabase link --project-ref <ref>
   supabase db push          # applies /supabase/migrations in order
   ```

   Or paste each file in `/supabase/migrations` into the SQL editor in order
   (`0001` → `0007`).

4. **Env vars** — copy and fill:

   ```bash
   cp .env.example .env.local
   # generate a fallback key:
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

5. **Run**

   ```bash
   npm run dev
   ```

6. **Browser extension** — load `/extension` unpacked (see `extension/README.md`),
   sign in to the app, then capture your session. Manual paste is available on the
   Connections page as a fallback.

## Apify configuration

- Set the five actor-ID env vars (connections, profile, posts, company, send DM).
  `APIFY_ACTOR_COMPANY` is optional — leave blank to skip company-page enrichment.
- Runs are started with an ad-hoc webhook pointed at `APP_BASE_URL/api/webhooks/apify`
  carrying `APIFY_WEBHOOK_SECRET`. No long-polling occurs in any serverless function.
- Cookie-based actors (connections, send DM) use Apify **residential** proxy, geo-matched
  to the user's `proxy_country` when set.
- ⚠️ Actor input field names are best-effort and marked with `TODO(confirm)` in code —
  verify each against the chosen actor on a real profile before launch.

## Deploy to Vercel

1. Import the GitHub repo (Next.js auto-detected).
2. Add every variable from `.env.example` in Project Settings → Environment Variables.
3. `vercel.json` registers a **daily** cron `0 8 * * *` → `/api/cron/process-queue`
   (Vercel **Hobby/free** plan only allows once-per-day crons; sub-daily schedules
   need Pro). Vercel sends `Authorization: Bearer $CRON_SECRET` automatically.
   - **Tradeoff:** a daily run processes the queue once (up to the cap), so it loses
     intraday pacing. For tighter ~15-min pacing on the free tier, trigger the same
     endpoint externally — e.g. GitHub Actions, cron-job.org, or Supabase `pg_cron`
     + `pg_net` — passing `Authorization: Bearer $CRON_SECRET`. Redundant triggers
     are safe (items are claimed atomically and cap-limited). On Pro, change the
     schedule back to `*/15 * * * *`.
4. Point Apify run webhooks at `https://<your-app>/api/webhooks/apify`.
5. Add the production redirect URL to the Supabase LinkedIn provider.
6. Publish the extension and add your production origin to its `host_permissions`.

## Smoke test (definition of done)

OIDC login creates a user → extension captures the cookie (absent from any client
payload) → sync + Tier-1 filter → selecting persists leads (and nothing else does) →
enrich fills Tier-2 fields → generate (draft) → approve (no queue rows) → Send one
message (a single queue row appears) → cron delivers it with jitter → reaching the
daily cap blocks further Sends → an expired cookie flips the account to `needs_reauth`
and pauses delivery.

## Open items (`TODO(confirm)`)

- Exact daily caps & ramp curve (defaults: 15 → ~35/day, +5/week).
- Final actor choices + exact input/output field names after testing on real profiles.
- Default OpenRouter model + user override (override implemented; default configurable).
- Cap-reached behavior is **block Send** with a "continue tomorrow" notice (no queuing).
- Auto-purge cadence for enrichment `raw` (manual purge implemented; cron TBD).
- Optional "light enrich all" background job for full-network Tier-2 filtering.
- Connect-time validation: currently a format check + first-sync validation (no
  long-poll). A dedicated async cheap-test run could set `last_validated` via webhook.
```
