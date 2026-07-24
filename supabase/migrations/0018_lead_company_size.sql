-- 0018_lead_company_size.sql
-- Company employee count (from Unipile company retrieval) used to pick the
-- size tier in the FLUGIA positioning playbook (persona × size → priority axis).

alter table public.leads add column if not exists company_size int;
