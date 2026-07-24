-- 0017_lead_known.sql
-- Per-lead relationship flag: whether the sender already knows this person.
-- Drives the AI message tone (warmer & more familiar when true, more formal
-- and professional when false).

alter table public.leads add column if not exists known boolean not null default false;
