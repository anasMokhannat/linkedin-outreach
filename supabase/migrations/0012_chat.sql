-- 0012_chat.sql
-- Map a lead to its Unipile/LinkedIn 1:1 chat so we can show the full
-- conversation (our messages + their replies) and reply in a chat UI.
alter table public.leads add column if not exists provider_chat_id text;
