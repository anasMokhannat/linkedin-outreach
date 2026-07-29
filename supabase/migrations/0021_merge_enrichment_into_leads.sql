-- 0021_merge_enrichment_into_leads.sql
-- Fold lead_enrichment into the leads table: enrichment detail now lives on the
-- lead row itself, and the separate lead_enrichment table is removed.

-- 1. Add the enrichment columns to leads (company_size already exists from 0018).
alter table public.leads
  add column if not exists summary text,
  add column if not exists experiences jsonb,
  add column if not exists education jsonb,
  add column if not exists skills jsonb,
  add column if not exists company jsonb,
  add column if not exists recent_posts jsonb,
  add column if not exists raw jsonb;

-- 2. Backfill from the old table if it still exists (coalesce so a re-run never
--    clobbers data already written straight to leads).
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'lead_enrichment'
  ) then
    update public.leads l set
      summary      = coalesce(l.summary, e.summary),
      experiences  = coalesce(l.experiences, e.experiences),
      education    = coalesce(l.education, e.education),
      skills       = coalesce(l.skills, e.skills),
      company      = coalesce(l.company, e.company),
      recent_posts = coalesce(l.recent_posts, e.recent_posts),
      raw          = coalesce(l.raw, e.raw)
    from public.lead_enrichment e
    where e.lead_id = l.id;
  end if;
end $$;

-- 3. Drop the now-redundant table.
drop table if exists public.lead_enrichment cascade;
