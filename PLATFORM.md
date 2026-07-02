# Flugia — LinkedIn Outreach Platform

Flugia is a multi-tenant SaaS for running personalized LinkedIn outreach at a
safe, human pace. A user signs up with email/password, connects a LinkedIn
account (via **Unipile**, a managed LinkedIn API), syncs their 1st‑degree
connections, filters them to an ideal‑customer profile (ICP), enriches them,
groups them into campaigns, generates a tailored message per lead with an LLM,
approves/edits/sends within strict daily/weekly caps, and manages replies from a
unified inbox.

---

## 1. Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router, TypeScript, React 18) |
| Hosting | Vercel (serverless route handlers, daily cron) |
| Database | Supabase Postgres (accessed **service-role only**; RLS is deny‑all) |
| LinkedIn API | **Unipile** (managed — login, profiles, relations, messaging, webhooks) |
| LLM | **OpenRouter** (default model `openai/gpt-4o-mini`) |
| Auth | Custom email/password (scrypt hash) + signed httpOnly cookie |
| Styling | Global CSS with design tokens (CSS custom properties) |

There is **no client-side Supabase client** and **no Supabase Auth**. All data
access happens server-side through the service-role key, filtered explicitly by
`account_id`/`user_id` in code.

---

## 2. Identity & tenancy model

Two independent layers:

1. **App user** (`users` table) — email + scrypt password hash. The session is a
   signed httpOnly cookie **`fl_user`** holding `users.id`
   (`lib/session.ts`, HMAC‑SHA256 with the service‑role key as the signing key).
2. **LinkedIn account** (`linkedin_accounts` table) — each user owns **one**
   LinkedIn connection (`linkedin_accounts.user_id`, unique). This is what talks
   to Unipile.

All business data (leads, campaigns, messages, usage, notifications) is keyed by
`account_id` (`linkedin_accounts.id`). Access is gated **user → their LinkedIn
account → their data**.

Key auth helpers (`lib/auth.ts`):

- `getUserId()` / `requireUserId()` — read/verify the `fl_user` cookie.
- `getAccountId()` — resolve the user's connected LinkedIn account id (or null).
- `requireAccountId()` — 401 if logged out, **409 if logged in but no LinkedIn
  connected**, else the account id.

**Signing out of the app** (`POST /api/auth/logout`) clears only the `fl_user`
cookie — the LinkedIn connection stays live on Unipile and reappears on next
login. **Disconnecting LinkedIn** (Settings) removes the Unipile account and
detaches it from the user, but keeps the app session.

### Routing / gating

- `middleware.ts` — presence check on `fl_user`; unauthenticated hits to
  `/dashboard`, `/leads`, `/campaigns`, `/inbox`, `/settings`, `/connect`
  redirect to `/login`.
- `app/page.tsx` (root) — no user → `/login`; user with LinkedIn → `/dashboard`;
  user without LinkedIn → `/connect` (unless they clicked **Skip for now**,
  tracked by a `fl_skip_connect` cookie).
- `app/(app)/layout.tsx` — requires a user; LinkedIn is optional (a "not
  connected" chip shows in the top bar until connected).

---

## 3. External integrations

### Unipile (`lib/unipile.ts`)
Managed LinkedIn API. The app never shows the Unipile UI. Used for:

- **Connect** — native credentials login (`POST /accounts`), with checkpoint
  handling for 2FA/OTP and `IN_APP_VALIDATION` (approve-on-phone) flows. Cookie
  (`li_at`) connect exists as a hidden fallback.
- **Account identity** — the stable LinkedIn owner id (`connection_params.im.id`)
  is stored as `owner_member_id` so reconnects reuse the same account row (the
  Unipile `account_id` changes on every reconnect).
- **Relations** — paginated 1st‑degree connections (`/users/relations`); only
  name + headline + profile URL + member id are available here.
- **Profile enrichment** — `/users/{id}?linkedin_sections=*` for full profile
  (experience, education, skills, industry, and email when exposed) + `/users/{id}/posts`.
- **Messaging** — list chats, read messages (`is_sender` flag), send messages
  (`POST /chats`, robust to stale chat ids by re-resolving via attendee id).
- **Webhooks** — `message_received` for instant replies (auto-registered on
  connect at `/api/webhooks/unipile-messages?s=<token>`).

### OpenRouter (`lib/openrouter.ts`)
`generateMessage()` produces one short (<600 char) warm, specific message per
lead, grounded on: the recipient's role/company/industry + recent posts, the
campaign's CTA (goal) and offer (value-prop), and the sender's **company
context** (description, services, USPs, pain points from Settings).

---

## 4. Data model (Postgres)

Migrations live in `supabase/migrations/` (0001 → 0016). Current core tables:

| Table | Purpose | Key columns |
|---|---|---|
| `users` | App accounts | `email`, `password_hash`, company context (`company_name`, `company_description`, `company_services`, `company_usps`, `company_pain_points`) |
| `linkedin_accounts` | Tenant root / LinkedIn connection | `user_id` (unique), `unipile_account_id`, `owner_member_id`, `status`, `staged_connections` (jsonb), `staged_count`, `last_sync_*`, `dms_per_day`, `leads_to_message` |
| `leads` | Saved connections | `account_id`, `profile_url` (unique per account), `provider_member_id`, name/headline/company/title/location/industry/**email**, `enriched_at`, `provider_chat_id` |
| `lead_enrichment` | Full profile payload | `lead_id` (unique), `summary`, `experiences`, `education`, `skills`, `company`, `recent_posts`, `raw` (jsonb) |
| `offers` | Reusable value-props (per user) | `user_id`, `name` (holds the offer text), `description` |
| `campaigns` | Named outreach run | `account_id`, `name`, `cta`, `offer` (snapshot text), `offer_id`, `status` (`draft`/`active`/`paused`/`done`/`cancelled`) |
| `campaign_leads` | Membership + per-lead state | `campaign_id`, `account_id`, `lead_id`, `message_id`, `status` (`pending`/`generated`/`approved`/`sent`/`failed`/`skipped`) |
| `messages` | Generated/sent DMs | `account_id`, `lead_id`, `campaign_id`, `body`, `model`, `status`, `sent_at` |
| `daily_usage` | Per-day send counters | `account_id`, `day`, `dms_sent` (PK: account_id+day) |
| `notifications` | Reply alerts | `account_id`, `lead_id`, `body`, `read`, `created_at` |
| `send_log` | Audit events | `account_id`, `event`, `detail` (jsonb) |

RLS is enabled with **no policies** (deny-all) on every table — the service-role
client bypasses it, and all scoping is enforced in application code.

---

## 5. Application pages

All app pages live under `app/(app)/` behind the authenticated shell (top bar +
left nav).

- **/dashboard (Overview)** — stat cards (leads, sent today vs cap, total sent),
  recent leads, today's sending progress, recent activity. Shows a "Connect
  LinkedIn" prompt if the user skipped connecting.
- **/leads** — the core acquisition surface:
  1. **ICP form** — industry / title / company / name terms, matched against each
     connection's **headline** (the only field available pre-enrichment).
  2. **Matching connections** — select individually or "Select all new /
     Deselect all"; **Add to leads** persists them and **auto-enriches** (bounded
     to 30/request; the rest keep the manual Enrich button).
  3. **Leads table** — filter on enriched fields (industry/company/title/name),
     columns include email; per-lead Enrich, Profile modal, message history,
     delete; multi-select → **Add to campaign** (new or existing).
- **/campaigns** — grid of campaign cards (status badge + sent/total progress
  bar). "New campaign" modal: name, CTA, **offer dropdown** (from Settings), lead
  picker.
- **/campaigns/[id]** — single campaign pipeline: targeting (CTA/offer), status
  chips (pending/drafted/queued/sent/failed/skipped), action buttons
  (Generate → Activate & send / Send now / Pause / Resume / Cancel), the leads
  table with per-message **Approve / Edit / Skip**, and app-enforced sending
  limits with usage bars. (Messaging is **not** here — it lives in the Inbox.)
- **/inbox** — full-screen 3-pane chat: nav sidebar │ contacts list │
  conversation. Lists every lead that belongs to a campaign; each shows
  `title · company · ◆ campaign name`. Reply box sends via Unipile (counts
  against and is blocked by the daily limit).
- **/settings** — company context form (grounds AI generation), offers CRUD
  (single free-text field each), read-only sending limits, and connect/disconnect
  LinkedIn (embedded connect form when disconnected).
- **/login, /register** — email/password auth (`app/(auth)/`).
- **/connect** — connect a LinkedIn account (credentials + checkpoint/OTP/2FA),
  with **Skip for now** and Sign out.

---

## 6. Key flows

### Connect LinkedIn
`/connect` → `POST /api/linkedin/connect-credentials` → Unipile native login.
- Checkpoint returned → OTP code screen (`POST /api/linkedin/checkpoint`) or
  in-app approval polling (`POST /api/linkedin/poll`).
- On success `finalizeConnection()` (`lib/connect.ts`) resolves the stable owner
  id, associates/creates the `linkedin_accounts` row for the user (adopting an
  orphan row by owner id to preserve pre-existing data), registers the messaging
  webhook, and logs `session_connected`.

### Sync connections
Leads page auto-syncs on open if never synced or stale (>24h).
`POST /api/sync/connections` pulls all relations from Unipile into
`linkedin_accounts.staged_connections` (jsonb). `GET /api/connections` serves
them (with a lightweight `?meta=1` mode to check freshness without loading the
full blob).

### ICP → leads → enrichment
Filter staged connections by headline keywords → select → `POST /api/leads/select`
inserts `leads` rows and auto-enriches them (`lib/enrich.ts`, shared with the
manual `POST /api/leads/[id]/enrich`). Enrichment writes `lead_enrichment` and
copies role/company/industry/email onto the lead.

### Campaign lifecycle
1. Create (`POST /api/campaigns`) with name, CTA, chosen offer, lead ids.
2. **Generate** (`POST /api/campaigns/[id]/generate`) — one message per pending
   lead via OpenRouter, grounded on enrichment + offer + company context.
3. **Review** (`PATCH /api/campaigns/[id]/review`) — approve / edit / skip.
4. **Activate & send** (`PATCH /api/campaigns/[id]/status`) — approves and sends
   an immediate batch (capped ~8/request); status → `active`.
5. **Send now** (`POST /api/campaigns/[id]/send-now`) — send another batch.
6. Daily cron sends the rest; **Pause / Resume / Cancel** control the run.

Sending goes through `lib/campaign-sender.ts` (`sendCampaignBatch`), shared by
the interactive send and the cron, with pacing jitter and limit enforcement.

### Inbox & replies
`GET /api/inbox` returns campaign leads for the sidebar. `GET
/api/leads/[id]/conversation` loads a thread (fast path uses cached
`provider_chat_id`, re-resolves on miss). `POST /api/leads/[id]/chat` sends a
reply. Incoming replies hit the `message_received` webhook →
`POST /api/webhooks/unipile-messages` → creates a `notifications` row. The bell
(`app/components/Notifications.tsx`) polls `/api/notifications` every 25s.

---

## 7. Sending limits (`lib/limits.ts`)

App-defined and **not user-configurable**:

- **25 messages / day**, **100 messages / week** (trailing 7-day window).
- `getUsage(accountId)` reads `daily_usage` and returns `allowedNow`
  (min of daily/weekly remaining). Every send path checks this; the inbox reply
  box and campaign sends are blocked when the allowance is exhausted.
- Per-send jitter: 1.5–6s between messages in a batch.

---

## 8. Cron

`vercel.json` schedules `GET /api/cron/process-campaigns` daily at `08:00 UTC`.
It iterates active campaigns per account and dispatches `sendCampaignBatch` up to
the remaining allowance.

---

## 9. Environment variables (`lib/env.ts`)

| Variable | Scope | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | server | Service-role DB access + cookie/webhook HMAC key |
| `UNIPILE_DSN` | server | Unipile base URL (e.g. `https://api8.unipile.com:13443`) |
| `UNIPILE_API_KEY` | server | Unipile API key |
| `OPENROUTER_API_KEY` | server | OpenRouter API key |
| `OPENROUTER_MODEL` | server (opt) | LLM model (default `openai/gpt-4o-mini`) |
| `APP_BASE_URL` | server (opt) | Public base URL, used to build the webhook URL (default `http://localhost:3000`) |

**Never** reference the server secrets from client code.

---

## 10. Security model

- Passwords hashed with scrypt (`lib/password.ts`), constant-time verification.
- Session cookie is signed (HMAC‑SHA256) and httpOnly; forging requires the
  service-role key.
- Supabase RLS deny-all + service-role-only access; every query filters by
  `account_id`/`user_id` in code.
- Unipile webhook verified by a non-guessable `?s=<token>` derived from the
  service-role key (`webhookToken()`).
- LinkedIn credentials are passed to Unipile **once** during connect and never
  stored or logged.

---

## 11. Local setup

1. `npm install`
2. Create `.env.local` with the variables in §9.
3. Run the migrations in `supabase/migrations/` (in order) against your Supabase
   project. Migration `0016` also seeds a login user
   (`anas.mokhannat@flugia.com` / `Flugia2026!`).
4. `npm run dev` → http://localhost:3000
5. Register or log in, then connect a LinkedIn account (or Skip for now).

Scripts: `npm run dev`, `npm run build`, `npm run start`, `npm run lint`,
`npm run typecheck`.

---

## 12. Directory map

```
app/
  (auth)/          login, register (public)
  (app)/           authenticated shell: dashboard, leads, campaigns,
                   campaigns/[id], inbox, settings
  connect/         LinkedIn connect flow (ConnectForm)
  api/
    auth/          register, login, logout
    linkedin/      connect, connect-credentials, checkpoint, poll, link
    leads/         list, select, [id] (get/delete), enrich, conversation,
                   chat, messages
    connections/   staged connections (+ ?meta)
    sync/          connections sync
    campaigns/     list/create, [id] (get/delete), generate, review, status,
                   send-now, leads
    offers/        list/create, [id] (edit/delete)
    settings/      company context + linkedin status
    inbox/         inbox lead list
    notifications/ list + mark read
    webhooks/      unipile-messages
    cron/          process-campaigns
  components/       Nav, Topbar, Notifications, CampaignChat, ConfirmDialog, Logo, icons
lib/                auth, session, password, connect, unipile, enrich,
                    openrouter, campaign-sender, limits, caps, supabase-server,
                    env, http, log, types
supabase/migrations/ 0001 … 0016
middleware.ts        route presence guard
vercel.json          daily cron
```
