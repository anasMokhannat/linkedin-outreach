-- 0010_stable_owner_identity.sql
-- A tenant is now keyed by the LinkedIn account OWNER (a stable member id from
-- Unipile's connection_params.im.id), NOT the Unipile account_id — which changes
-- every time the user re-connects. Reconnecting the same LinkedIn person now
-- reuses the same tenant, so their leads / messages / settings / stats persist.

alter table public.linkedin_accounts add column if not exists owner_member_id text;

-- One-time backfill + consolidation of dev rows created before this change.
-- (These three Unipile accounts all belong to the same LinkedIn owner.)
update public.linkedin_accounts
  set owner_member_id = 'ACoAADPAZvcBi-_py2tZa2cvesotvqHD7aU9QIY'
  where unipile_account_id in (
    'JRgv_H0jSuGaFzB-c4_n7w', 'RXo1cjmBTHW2obPihWRaMA', 'd1pYddkLRTqJU2IamciTzA'
  );

-- Consolidate duplicates: keep the earliest row per owner, repoint all child
-- data to it, delete the duplicate account rows.
do $$
declare o text; canon uuid;
begin
  for o in select distinct owner_member_id from public.linkedin_accounts where owner_member_id is not null loop
    select id into canon from public.linkedin_accounts
      where owner_member_id = o order by created_at asc limit 1;

    -- drop leads that would collide on the unique (account_id, profile_url)
    delete from public.leads dup using public.leads keep
      where keep.account_id = canon and keep.profile_url = dup.profile_url
        and dup.account_id <> canon
        and dup.account_id in (select id from public.linkedin_accounts where owner_member_id = o);

    update public.leads           set account_id = canon where account_id in (select id from public.linkedin_accounts where owner_member_id = o and id <> canon);
    update public.lead_enrichment set account_id = canon where account_id in (select id from public.linkedin_accounts where owner_member_id = o and id <> canon);
    update public.messages        set account_id = canon where account_id in (select id from public.linkedin_accounts where owner_member_id = o and id <> canon);
    update public.send_log        set account_id = canon where account_id in (select id from public.linkedin_accounts where owner_member_id = o and id <> canon);
    delete from public.daily_usage where account_id in (select id from public.linkedin_accounts where owner_member_id = o and id <> canon);

    delete from public.linkedin_accounts where owner_member_id = o and id <> canon;
  end loop;
end $$;

-- One tenant per owner going forward.
create unique index if not exists linkedin_accounts_owner_uniq
  on public.linkedin_accounts(owner_member_id) where owner_member_id is not null;
