-- 0008_unipile.sql
-- Support the Unipile provider (managed LinkedIn API).
--
-- Unipile holds the LinkedIn session itself and gives us an `account_id`; we
-- store that instead of (or alongside) the Vault cookie ref. Connections come
-- back inline (sync), so we stage them transiently in a jsonb column rather than
-- in an external Apify dataset. To message a relation later we need its Unipile
-- "provider internal id" (member_id), so leads gain provider_member_id.

alter table public.linkedin_accounts
  add column if not exists unipile_account_id text,
  add column if not exists staged_connections jsonb;

alter table public.leads
  add column if not exists provider_member_id text;
