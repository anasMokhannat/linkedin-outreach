-- 0023_lead_enrich_status.sql
-- Track enrichment completeness so throttled profiles (LinkedIn withholds the
-- experience section on bulk retrieval → no company/title) can be re-enriched
-- later, without re-enriching fully-enriched leads or looping forever.
--   enrich_status: NULL = never enriched, 'partial' = experience was throttled
--   (retry later), 'full' = complete.
--   enrich_attempts: caps how many times we retry a stubbornly-throttled lead.

alter table public.leads
  add column if not exists enrich_status text check (enrich_status in ('full', 'partial')),
  add column if not exists enrich_attempts int not null default 0;

-- Backfill existing rows so already-enriched leads aren't re-enriched as if new:
--  - enriched WITH a company  → 'full'  (done)
--  - enriched WITHOUT a company → 'partial' (likely throttled → retry later)
--  - never enriched → leave NULL (still in the "to enrich" queue)
update public.leads
  set enrich_status = case
    when current_company is null or current_company = '' then 'partial'
    else 'full'
  end
  where enriched_at is not null and enrich_status is null;
