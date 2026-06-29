-- 0014_notifications.sql
-- In-app notifications, created when a lead replies (via the Unipile
-- message_received webhook).
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.linkedin_accounts(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  kind text not null default 'reply',
  body text,
  chat_id text,
  read boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists idx_notifications_account on public.notifications(account_id, read, created_at desc);
alter table public.notifications enable row level security;
