-- 0022_user_writer_role.sql
-- The nature of the person sending outreach: an internal FLUGIA associate/team
-- member, or an external partner/reseller. Drives how the AI refers to FLUGIA
-- (first person "nous/notre" for associates, third person for partners).
-- Existing users default to 'partner' (the app's primary audience).

alter table public.users
  add column if not exists writer_role text not null default 'partner'
    check (writer_role in ('associate', 'partner'));
