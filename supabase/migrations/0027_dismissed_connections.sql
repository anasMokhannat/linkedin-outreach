-- 0027_dismissed_connections.sql
-- Let users remove a connection from the in-app Connections list WITHOUT touching
-- the real LinkedIn connection. We store the dismissed profile URLs on the account
-- and filter them out when serving the list, so they stay hidden even after the
-- next sync re-fetches all relations.

alter table public.linkedin_accounts
  add column if not exists dismissed_connections jsonb not null default '[]'::jsonb;
