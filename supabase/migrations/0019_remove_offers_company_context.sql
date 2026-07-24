-- 0019_remove_offers_company_context.sql
-- Company context + offers are no longer user-editable — generation is now
-- grounded on the FLUGIA positioning playbook (in code). Drop the unused offers
-- table, the campaign->offer link, and the per-user company-context columns.
-- (users.company_name is kept — it's basic account info captured at register.)

alter table public.campaigns drop column if exists offer_id;
drop table if exists public.offers cascade;

alter table public.users drop column if exists company_description;
alter table public.users drop column if exists company_services;
alter table public.users drop column if exists company_usps;
alter table public.users drop column if exists company_pain_points;
