-- 0006_sync_pointer.sql
-- Transient pointer to the most recent connections-sync run. We do NOT persist
-- raw connections; we only remember which Apify dataset currently holds the
-- staged results so the Connections page can read + Tier-1 filter them.
-- The dataset itself expires on Apify per its retention.

alter table public.linkedin_accounts
  add column if not exists last_sync_run_id text,
  add column if not exists last_sync_dataset_id text,
  add column if not exists last_sync_status text
    check (last_sync_status in ('running','succeeded','failed') or last_sync_status is null),
  add column if not exists last_sync_at timestamptz;
