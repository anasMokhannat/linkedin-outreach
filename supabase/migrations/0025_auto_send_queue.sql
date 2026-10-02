-- 0025_auto_send_queue.sql
-- Automated sending: once the user hits the daily cap, drafts are marked
-- status='queued' (already a valid state in 0001) and a scheduler (external
-- cron hitting /api/cron/auto-send) drains them, one at a time, during business
-- hours with randomized gaps, respecting the daily/weekly caps.
--
-- `next_auto_send_at` is the earliest moment the scheduler may send the NEXT
-- queued message for this account. It is pushed forward by a random gap after
-- every auto-send, which is what makes the send times look irregular instead of
-- firing on the cron's fixed grid.

-- 0009 recreated public.messages WITHOUT 'queued' in the status check
-- (only draft/approved/sent/failed/rejected). Re-add 'queued' so drafts can be
-- parked for the scheduler. Drop-then-add keeps this idempotent / re-runnable.
alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages
  add constraint messages_status_check
  check (status in ('draft','approved','queued','sent','failed','rejected'));

alter table public.linkedin_accounts
  add column if not exists next_auto_send_at timestamptz;

-- Helps the scheduler pick the oldest queued message per account quickly.
create index if not exists idx_messages_account_queued
  on public.messages (account_id, created_at)
  where status = 'queued';
