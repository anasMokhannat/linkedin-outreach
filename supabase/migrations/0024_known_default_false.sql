-- 0024_known_default_false.sql
-- "known" is now declared per connection BEFORE adding it as a lead (on the
-- Connections page). New leads therefore default to NOT known (cold outreach →
-- they get enriched); the user marks the ones they already know, which skip
-- enrichment and use the warm/familiar message.
-- (Existing rows are left as-is; this only changes the default for new inserts.)

alter table public.leads alter column known set default false;
