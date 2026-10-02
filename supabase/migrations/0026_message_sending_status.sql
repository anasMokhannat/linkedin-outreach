-- 0026_message_sending_status.sql
-- Fix duplicate auto-sends: the scheduler now atomically CLAIMS a queued message
-- by flipping it to 'sending' before contacting LinkedIn, so two overlapping cron
-- ticks can't both send the same message. Add 'sending' to the allowed statuses.
-- Idempotent / re-runnable.

alter table public.messages drop constraint if exists messages_status_check;
alter table public.messages
  add constraint messages_status_check
  check (status in ('draft','approved','queued','sending','sent','failed','rejected'));
