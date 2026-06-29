-- 0013_campaign_cancel.sql
-- Allow campaigns to be cancelled (stopped entirely).
alter table public.campaigns drop constraint if exists campaigns_status_check;
alter table public.campaigns
  add constraint campaigns_status_check
  check (status in ('draft','active','paused','done','cancelled'));
