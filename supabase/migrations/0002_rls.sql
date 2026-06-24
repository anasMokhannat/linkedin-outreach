-- 0002_rls.sql
-- Row-level security on every table. Each user sees only their own rows.
-- Server jobs use the service role key (bypasses RLS) and MUST filter by
-- user_id in code (spec hard rule).

alter table public.users            enable row level security;
alter table public.linkedin_accounts enable row level security;
alter table public.leads            enable row level security;
alter table public.lead_enrichment  enable row level security;
alter table public.messages         enable row level security;
alter table public.send_queue       enable row level security;
alter table public.daily_usage      enable row level security;
alter table public.send_log         enable row level security;

-- users: a row is "owned" by id == auth.uid()
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
  for select using (auth.uid() = id);
drop policy if exists users_self_update on public.users;
create policy users_self_update on public.users
  for update using (auth.uid() = id) with check (auth.uid() = id);
-- INSERT is performed by the signup trigger (security definer), not clients.

-- Generic owner-by-user_id policy macro, applied per table below.
-- linkedin_accounts
drop policy if exists la_select on public.linkedin_accounts;
create policy la_select on public.linkedin_accounts for select using (auth.uid() = user_id);
drop policy if exists la_insert on public.linkedin_accounts;
create policy la_insert on public.linkedin_accounts for insert with check (auth.uid() = user_id);
drop policy if exists la_update on public.linkedin_accounts;
create policy la_update on public.linkedin_accounts for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists la_delete on public.linkedin_accounts;
create policy la_delete on public.linkedin_accounts for delete using (auth.uid() = user_id);

-- leads
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads for select using (auth.uid() = user_id);
drop policy if exists leads_insert on public.leads;
create policy leads_insert on public.leads for insert with check (auth.uid() = user_id);
drop policy if exists leads_update on public.leads;
create policy leads_update on public.leads for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete using (auth.uid() = user_id);

-- lead_enrichment
drop policy if exists enr_select on public.lead_enrichment;
create policy enr_select on public.lead_enrichment for select using (auth.uid() = user_id);
drop policy if exists enr_insert on public.lead_enrichment;
create policy enr_insert on public.lead_enrichment for insert with check (auth.uid() = user_id);
drop policy if exists enr_update on public.lead_enrichment;
create policy enr_update on public.lead_enrichment for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists enr_delete on public.lead_enrichment;
create policy enr_delete on public.lead_enrichment for delete using (auth.uid() = user_id);

-- messages
drop policy if exists msg_select on public.messages;
create policy msg_select on public.messages for select using (auth.uid() = user_id);
drop policy if exists msg_insert on public.messages;
create policy msg_insert on public.messages for insert with check (auth.uid() = user_id);
drop policy if exists msg_update on public.messages;
create policy msg_update on public.messages for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists msg_delete on public.messages;
create policy msg_delete on public.messages for delete using (auth.uid() = user_id);

-- send_queue (clients can read their own queue; writes go through server/service role)
drop policy if exists sq_select on public.send_queue;
create policy sq_select on public.send_queue for select using (auth.uid() = user_id);
drop policy if exists sq_insert on public.send_queue;
create policy sq_insert on public.send_queue for insert with check (auth.uid() = user_id);
drop policy if exists sq_update on public.send_queue;
create policy sq_update on public.send_queue for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- daily_usage
drop policy if exists du_select on public.daily_usage;
create policy du_select on public.daily_usage for select using (auth.uid() = user_id);
drop policy if exists du_insert on public.daily_usage;
create policy du_insert on public.daily_usage for insert with check (auth.uid() = user_id);
drop policy if exists du_update on public.daily_usage;
create policy du_update on public.daily_usage for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- send_log
drop policy if exists sl_select on public.send_log;
create policy sl_select on public.send_log for select using (auth.uid() = user_id);
drop policy if exists sl_insert on public.send_log;
create policy sl_insert on public.send_log for insert with check (auth.uid() = user_id);
