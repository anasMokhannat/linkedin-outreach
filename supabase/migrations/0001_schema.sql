-- 0001_schema.sql
-- Core schema for the LinkedIn outreach platform (spec §7).
-- Raw connections are NEVER stored; only selected leads + enrichment persist.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users (mirrors auth.users; populated by trigger on signup)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  timezone text default 'UTC',
  -- Per-user config (Phase 5). Defaults match spec.
  dms_start_cap int default 15,
  dms_max_cap int default 35,
  ramp_per_week int default 5,
  working_start_hour int default 9,
  working_end_hour int default 18,
  value_prop text,
  openrouter_model text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- linkedin_accounts (one per user; holds the Vault secret ref, never the cookie)
-- ---------------------------------------------------------------------------
create table if not exists public.linkedin_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  li_secret_id uuid,
  status text not null default 'connected'
    check (status in ('connected','needs_reauth','disconnected')),
  proxy_country text,
  last_validated timestamptz,
  created_at timestamptz default now(),
  unique (user_id)
);

-- ---------------------------------------------------------------------------
-- leads (FIRST persistence point — only selected leads land here)
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  profile_url text not null,
  first_name text,
  last_name text,
  headline text,
  current_company text,
  current_title text,
  location text,
  school text,
  industry text,
  enriched_at timestamptz,
  created_at timestamptz default now(),
  unique (user_id, profile_url)
);

-- ---------------------------------------------------------------------------
-- lead_enrichment (cookieless: posts + company + raw)
-- ---------------------------------------------------------------------------
create table if not exists public.lead_enrichment (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  recent_posts jsonb,
  company jsonb,
  raw jsonb,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- messages (state machine: draft → approved → queued → sent/failed; → rejected)
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  body text not null,
  model text,
  status text not null default 'draft'
    check (status in ('draft','approved','queued','sent','failed','rejected')),
  edited_by_user boolean default false,
  approved_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- send_queue (populated ONLY by an explicit per-message Send click — Gate 3)
-- ---------------------------------------------------------------------------
create table if not exists public.send_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  message_id uuid not null references public.messages(id) on delete cascade,
  scheduled_for timestamptz not null,
  attempts int default 0,
  status text not null default 'pending'
    check (status in ('pending','processing','done','failed')),
  apify_run_id text,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- daily_usage (per-user per-day DM counter; cap enforcement)
-- ---------------------------------------------------------------------------
create table if not exists public.daily_usage (
  user_id uuid not null references public.users(id) on delete cascade,
  day date not null,
  dms_sent int default 0,
  primary key (user_id, day)
);

-- ---------------------------------------------------------------------------
-- send_log (audit trail)
-- ---------------------------------------------------------------------------
create table if not exists public.send_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  event text,
  detail jsonb,
  created_at timestamptz default now()
);

-- Helpful indexes
create index if not exists idx_leads_user on public.leads(user_id);
create index if not exists idx_messages_user_status on public.messages(user_id, status);
create index if not exists idx_send_queue_due on public.send_queue(status, scheduled_for);
create index if not exists idx_enrichment_lead on public.lead_enrichment(lead_id);

-- keep messages.updated_at fresh
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end; $$;

drop trigger if exists trg_messages_touch on public.messages;
create trigger trg_messages_touch before update on public.messages
  for each row execute function public.touch_updated_at();
