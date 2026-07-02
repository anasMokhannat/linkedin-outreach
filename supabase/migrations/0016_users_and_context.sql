-- 0016_users_and_context.sql
-- Adds a real APP USER layer (email/password) that is independent of the
-- LinkedIn connection. Identity is now: app user -> owns one LinkedIn account ->
-- owns all leads/campaigns/messages/settings. Logging out of the app clears the
-- user session but leaves the LinkedIn (Unipile) connection intact.
--
-- Also adds: per-user company context + reusable offers (for AI generation and
-- the campaign offer dropdown), a campaign->offer link, and a lead email column.

-- --- app users --------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  -- Company context used to ground AI message generation (settings form).
  company_name text,
  company_description text,
  company_services text,
  company_usps text,
  company_pain_points text,
  created_at timestamptz default now()
);
create unique index if not exists users_email_uniq on public.users (lower(email));
alter table public.users enable row level security;

-- --- link each LinkedIn account to an app user (1:1) ------------------------
alter table public.linkedin_accounts
  add column if not exists user_id uuid references public.users(id) on delete cascade;

-- The owner-member id is no longer the global tenant key; a user owns one
-- account. Drop the global-owner unique index, enforce one account per user.
drop index if exists public.linkedin_accounts_owner_uniq;
create unique index if not exists linkedin_accounts_user_uniq
  on public.linkedin_accounts(user_id) where user_id is not null;

-- --- reusable offers (per user) --------------------------------------------
create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz default now()
);
create index if not exists idx_offers_user on public.offers(user_id);
alter table public.offers enable row level security;

-- Campaign -> chosen offer (the offer text is also snapshotted in campaigns.offer).
alter table public.campaigns
  add column if not exists offer_id uuid references public.offers(id) on delete set null;

-- --- lead contact email (from enrichment, when LinkedIn exposes it) ---------
alter table public.leads add column if not exists email text;

-- --- seed a login user ------------------------------------------------------
-- Credentials:  email = anas.mokhannat@flugia.com   password = Flugia2026!
-- The password_hash is scrypt (salt$hash), the same scheme lib/password.ts uses.
-- Idempotent: does nothing if the email already exists.
insert into public.users (email, password_hash)
values (
  'anas.mokhannat@flugia.com',
  'scrypt$59196ceffe9d1cdf4bc92fbb4b6fbbf3$ca658dff2e3a06ccfd9dfd799427766c0eec7e54d37797d252f1a0ce2d308a5da7332d2d683e6f251fc35de2d5e1a113e5284b93efe2c46ca97f6e475e6505dc'
)
on conflict (lower(email)) do nothing;
