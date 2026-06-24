-- 0007_enrichment_unique.sql
-- One enrichment row per lead so the profile / posts / company actors (which
-- finish independently) can each merge their slice into the same row.

alter table public.lead_enrichment
  add constraint lead_enrichment_lead_unique unique (lead_id);
