-- 0011_campaigns.sql
-- Campaigns: a named outreach run with a CTA + offer, targeting many leads.
-- Each lead in a campaign gets ONE personalized message; messages are sent
-- over time, throttled to app-defined LinkedIn/Unipile limits (enforced in code,
-- not user-configurable).

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linkedin_accounts(id) on delete cascade,
  name text not null,
  cta text,
  offer text,
  status text not null default 'draft'
    check (status in ('draft','active','paused','done')),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Membership + per-lead state within a campaign.
create table if not exists public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  account_id uuid not null references public.linkedin_accounts(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  message_id uuid references public.messages(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','generated','approved','sent','failed','skipped')),
  error text,
  sent_at timestamptz,
  created_at timestamptz default now(),
  unique (campaign_id, lead_id)
);

-- Tie each message to its campaign (null = ad-hoc, non-campaign message).
alter table public.messages add column if not exists campaign_id uuid
  references public.campaigns(id) on delete set null;

create index if not exists idx_campaigns_account on public.campaigns(account_id);
create index if not exists idx_campaign_leads_campaign on public.campaign_leads(campaign_id);
create index if not exists idx_campaign_leads_status on public.campaign_leads(account_id, status);
create index if not exists idx_messages_campaign on public.messages(campaign_id);

-- keep campaigns.updated_at fresh (touch_updated_at from 0001)
drop trigger if exists trg_campaigns_touch on public.campaigns;
create trigger trg_campaigns_touch before update on public.campaigns
  for each row execute function public.touch_updated_at();

-- RLS: deny-all (service role only), consistent with the rest of the schema.
alter table public.campaigns enable row level security;
alter table public.campaign_leads enable row level security;
