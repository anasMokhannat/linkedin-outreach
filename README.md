# LinkedIn Personalized Outreach Platform

A multi-tenant Next.js app where each user connects their LinkedIn account (via
[Unipile](https://developer.unipile.com)), syncs 1st-degree connections, filters them
into leads, enriches selected leads, generates personalized messages, and **explicitly
approves then sends** them — one at a time, throttled to stay within LinkedIn's limits.

> ⚠️ This automates actions on a user's LinkedIn account and operates against LinkedIn's
> Terms of Service; it carries account-restriction risk. Sending limits are conservative
> by default. Surface this to users during onboarding.

## Stack

Next.js (App Router, TS) · Supabase (Postgres + Auth) · Unipile · OpenRouter · Vercel.
No Python in the app.

## The three gates (core flow)

1. **Request** (Gate 1) — generate a draft via OpenRouter → `messages.status = draft`.
2. **Approve** (Gate 2) — review/edit/approve. Approval alone queues nothing.
3. **Send** (Gate 3) — explicit per-message Send → the DM is sent **immediately and
   synchronously** via Unipile (no queue, no cron). Blocked with a "continue tomorrow"
   notice once the daily cap is reached.

The daily cap (ramp-aware) is enforced server-side at send time. One message at a time;
no bulk send.

`draft → approved → sent` (or stays `approved` on a transient failure); `draft/approved
→ rejected`. Sending happens **only** on the explicit Send click.

## Unipile integration

All LinkedIn I/O goes through Unipile (managed LinkedIn API). Unipile holds the LinkedIn
session on its side; we authenticate with an account-wide `UNIPILE_API_KEY` and reference
a per-user `account_id` (stored on `linkedin_accounts.unipile_account_id`).

- **Connect** — in-app, no Unipile UI:
  - **Email & password** (primary): `POST /api/linkedin/connect-credentials` → Unipile logs
    in server-side. If LinkedIn issues a 2FA/OTP checkpoint, the route returns
    `{ status: 'checkpoint' }` and the user submits the code to
    `POST /api/linkedin/checkpoint`. The password passes through the server to Unipile once
    and is **never stored or logged**.
  - **Cookie** (fallback): paste `li_at` → handed to Unipile once via `POST /accounts`; we
    persist only the returned `account_id` — **never the raw cookie**. Can be browsing-
    restricted by LinkedIn if used from a different IP.

  Either way we verify the account reaches an `OK` state before marking it connected.
- **Connections** — `GET /users/relations` (cursor-paginated), staged inline in
  `linkedin_accounts.staged_connections` (transient).
- **Enrichment** — `GET /users/{id}` (role/company/location/school) + `GET /users/{id}/posts`
  (recent posts), synchronous.
- **Send DM** — `POST /chats` with the lead's stored `provider_member_id` as the recipient.

Everything is synchronous (no scraping webhooks). Auth errors from Unipile flip the
account to `needs_reauth` and pause delivery.

## Security model (non-negotiable)

- Credentials (email/password or `li_at`) are handed to Unipile **once** to connect and
  are **never stored, returned to the browser, or logged** — we keep only the Unipile
  `account_id`.
- The Supabase **service role key** is server-only; background work that bypasses RLS
  filters by `user_id` explicitly in code.
- **RLS** is enabled on every table (`auth.uid() = user_id`).
- Daily caps and ramp-up are enforced **server-side** at send time.

## Project layout

```
/app
  /(auth)/login              # app login (LinkedIn OIDC or Dev login)
  /auth/callback             # OAuth code exchange
  /(app)                     # authenticated shell (sidebar + guard)
    /dashboard /connections /leads /messages /settings
  /api/...                   # see "API surface" below
/lib                         # env, supabase clients, unipile, connect, openrouter, caps, ...
/supabase/migrations         # schema + RLS + triggers + usage RPC + Unipile columns
```

## API surface

```
POST   /api/linkedin/connect-credentials  connect via Unipile (email & password)
POST   /api/linkedin/checkpoint           submit a 2FA/OTP code to finish connecting
POST   /api/linkedin/connect              connect via li_at cookie (fallback); DELETE to disconnect
POST   /api/sync/connections       sync 1st-degree relations -> transient staging
GET    /api/connections            Tier-1 filtered staging view
POST   /api/leads/select           persist selected leads (first persistence point)
GET    /api/leads                  list leads + Tier-2 filters
DELETE /api/leads/:id              delete a lead (cascades enrichment + messages)
POST   /api/leads/:id/enrich       Unipile profile + recent posts enrichment
POST   /api/messages/generate      Gate 1: OpenRouter draft
GET    /api/messages               list messages + daily cap status
PATCH  /api/messages/:id           Gate 2: edit / approve / reject
POST   /api/messages/:id/send      Gate 3: send one message now via Unipile (cap-checked, 429 if reached)
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
   - **Auth → LinkedIn (OIDC)** provider for app login (redirect `…/auth/callback`), or
     use the dev login (`NEXT_PUBLIC_DEV_AUTH=true`) to skip provider setup locally.

3. **Run migrations** — paste each file in `/supabase/migrations` into the SQL editor in
   order (`0001` → `0008`), or `supabase db push`. (The Vault RPCs in `0004` are no longer
   used by the app but are harmless if already applied.)

4. **Env vars**

   ```bash
   cp .env.example .env.local   # then fill in Supabase, Unipile, OpenRouter
   ```

5. **Get Unipile credentials** — from the Unipile dashboard: `UNIPILE_DSN`
   (e.g. `api8.unipile.com:13443`) and an access token → `UNIPILE_API_KEY`.

6. **Run**

   ```bash
   npm run dev
   ```

7. **Connect LinkedIn** — Connections page → enter your LinkedIn email & password (and your
   country). If LinkedIn asks for a 2FA/OTP code, a field appears to submit it.

## Deploy to Vercel

1. Import the GitHub repo (Next.js auto-detected).
2. Add every variable from `.env.example` in Project Settings → Environment Variables
   (set `APP_BASE_URL` to your production URL).
3. Add your production redirect URL to the Supabase LinkedIn provider (if using OIDC).

Sending is synchronous on the Send click, so no cron/scheduler is required.

## Smoke test (definition of done)

Login creates a user → connect LinkedIn via Unipile (email/password, with 2FA if asked) → sync +
Tier-1 filter → selecting persists leads (and nothing else does) → enrich fills Tier-2
fields + recent posts → generate (draft) → approve → Send one message (sent immediately
via Unipile) → reaching the daily cap blocks further Sends → a Unipile auth error flips
the account to `needs_reauth`.

## Open items (`TODO(confirm)`)

- Exact daily caps & ramp curve (defaults: 15 → ~35/day, +5/week).
- Unipile response field shapes (profile industry, posts, checkpoint type values,
  chat `attendees_ids` = `member_id`) are mapped per the docs — confirm against live calls.
- Default OpenRouter model + user override (override implemented; default configurable).
- Cap-reached behavior is **block Send** with a "continue tomorrow" notice (no queuing).
- Auto-purge cadence for enrichment `raw` (manual purge implemented).
