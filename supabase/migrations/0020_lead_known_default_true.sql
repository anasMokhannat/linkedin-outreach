-- 0020_lead_known_default_true.sql
-- Leads are "known" by default now (warmer, familiar tone unless toggled off).
-- Flip the column default and bring existing rows in line.

alter table public.leads alter column known set default true;
update public.leads set known = true where known is distinct from true;
