-- 0005_usage_rpc.sql
-- Atomic per-user daily DM counter increment, used by the webhook handler after
-- a confirmed successful send. Avoids read-modify-write races across cron ticks.

create or replace function public.app_increment_daily_usage(p_user_id uuid, p_day date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  insert into public.daily_usage (user_id, day, dms_sent)
  values (p_user_id, p_day, 1)
  on conflict (user_id, day)
  do update set dms_sent = public.daily_usage.dms_sent + 1
  returning dms_sent into v_count;
  return v_count;
end;
$$;

revoke all on function public.app_increment_daily_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.app_increment_daily_usage(uuid, date) to service_role;
