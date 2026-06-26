-- 0009_account_identity.sql
-- Identity model change: the connected LinkedIn (Unipile) account IS the tenant.
-- There is no separate app user anymore. `linkedin_accounts` becomes the tenant
-- root; all data is keyed by account_id. Access is server-side only (service
-- role + a signed session cookie); RLS is enabled with NO policies so anon /
-- authenticated keys get nothing.
--
-- DESTRUCTIVE: recreates leads / messages / lead_enrichment / daily_usage /
-- send_log keyed by account_id, and drops the removed send_queue. Existing dev
-- rows in those tables are lost; reconnect + re-sync.

-- --- drop old auth.uid()-based policies FIRST (they depend on user_id) --------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public'
      and tablename in ('linkedin_accounts','leads','lead_enrichment','messages','daily_usage','send_log','users')
  loop
    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- --- linkedin_accounts becomes the tenant root --------------------------------
alter table public.linkedin_accounts drop constraint if exists linkedin_accounts_user_id_fkey;
alter table public.linkedin_accounts drop constraint if exists linkedin_accounts_user_id_key;
alter table public.linkedin_accounts drop column if exists user_id;
alter table public.linkedin_accounts drop column if exists li_secret_id;
alter table public.linkedin_accounts drop column if exists last_sync_run_id;
alter table public.linkedin_accounts drop column if exists last_sync_dataset_id;

alter table public.linkedin_accounts add column if not exists display_name text;
alter table public.linkedin_accounts add column if not exists dms_per_day int default 25;
alter table public.linkedin_accounts add column if not exists leads_to_message int default 50;

-- Plain unique constraint (NOT a partial index) so upserts can use
-- ON CONFLICT (unipile_account_id). NULLs remain distinct, so disconnected
-- rows with a null id don't collide.
drop index if exists public.linkedin_accounts_unipile_uniq;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'linkedin_accounts_unipile_key') then
    alter table public.linkedin_accounts
      add constraint linkedin_accounts_unipile_key unique (unipile_account_id);
  end if;
end $$;

-- --- drop old user-scoped data tables ----------------------------------------
drop table if exists public.send_queue cascade;
drop table if exists public.send_log cascade;
drop table if exists public.lead_enrichment cascade;
drop table if exists public.messages cascade;
drop table if exists public.daily_usage cascade;
drop table if exists public.leads cascade;

-- --- recreate keyed by account_id --------------------------------------------
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linkedin_accounts(id) on delete cascade,
  profile_url text not null,
  provider_member_id text,
  first_name text, last_name text, headline text,
  current_company text, current_title text,
  location text, school text, industry text,
  enriched_at timestamptz,
  created_at timestamptz default now(),
  unique (account_id, profile_url)
);

create table public.lead_enrichment (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  account_id uuid not null references public.linkedin_accounts(id) on delete cascade,
  summary text,
  experiences jsonb,   -- full work history
  education jsonb,     -- schools
  skills jsonb,        -- skills + endorsements
  company jsonb,       -- current company data
  recent_posts jsonb,  -- recent activity
  raw jsonb,           -- full raw profile payload
  created_at timestamptz default now(),
  unique (lead_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linkedin_accounts(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  body text not null,
  model text,
  status text not null default 'draft'
    check (status in ('draft','approved','sent','failed','rejected')),
  edited_by_user boolean default false,
  approved_at timestamptz, sent_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table public.daily_usage (
  account_id uuid not null references public.linkedin_accounts(id) on delete cascade,
  day date not null,
  dms_sent int default 0,
  primary key (account_id, day)
);

create table public.send_log (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linkedin_accounts(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  event text, detail jsonb, created_at timestamptz default now()
);

create index if not exists idx_leads_account on public.leads(account_id);
create index if not exists idx_messages_account_lead on public.messages(account_id, lead_id);
create index if not exists idx_enrichment_lead on public.lead_enrichment(lead_id);

-- keep messages.updated_at fresh (function from 0001 still exists)
drop trigger if exists trg_messages_touch on public.messages;
create trigger trg_messages_touch before update on public.messages
  for each row execute function public.touch_updated_at();

-- --- RLS: enable, deny-all (service role bypasses) ---------------------------
alter table public.linkedin_accounts enable row level security;
alter table public.leads             enable row level security;
alter table public.lead_enrichment   enable row level security;
alter table public.messages          enable row level security;
alter table public.daily_usage       enable row level security;
alter table public.send_log          enable row level security;

-- --- per-account daily usage increment ---------------------------------------
-- Drop the old (p_user_id) signature first — CREATE OR REPLACE can't rename params.
drop function if exists public.app_increment_daily_usage(uuid, date);

create or replace function public.app_increment_daily_usage(p_account_id uuid, p_day date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  insert into public.daily_usage (account_id, day, dms_sent)
  values (p_account_id, p_day, 1)
  on conflict (account_id, day)
  do update set dms_sent = public.daily_usage.dms_sent + 1
  returning dms_sent into v_count;
  return v_count;
end; $$;

revoke all on function public.app_increment_daily_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.app_increment_daily_usage(uuid, date) to service_role;
