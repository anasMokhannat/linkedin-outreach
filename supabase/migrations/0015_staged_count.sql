-- 0015_staged_count.sql
-- Lightweight count of staged connections so the Leads page can decide whether
-- to auto-sync WITHOUT fetching the whole staged_connections jsonb blob.
alter table public.linkedin_accounts add column if not exists staged_count int default 0;
