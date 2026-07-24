-- ============================================================================
-- DEV SEED — preview the UI without connecting LinkedIn.
-- Run this in the Supabase SQL editor. Idempotent (safe to re-run).
-- Requires migrations up to 0017 (adds leads.email + leads.known).
--
-- It attaches a fake "connected" LinkedIn account to your first app user and
-- inserts a handful of mock leads (some marked known, some not) with a little
-- enrichment so the profile drawer looks populated.
--
-- NOTE: this is dev-only. Sending won't work (no real Unipile account). To
-- remove later: delete the leads / linkedin_accounts row for the demo account.
-- ============================================================================

do $$
declare
  v_user uuid;
  v_account uuid;
begin
  -- Use the first (seeded) app user.
  select id into v_user from public.users order by created_at asc limit 1;
  if v_user is null then
    raise notice 'No app user found — register/log in first, then re-run.';
    return;
  end if;

  -- Ensure a LinkedIn account row for this user (marks the app as "connected").
  select id into v_account from public.linkedin_accounts where user_id = v_user;
  if v_account is null then
    insert into public.linkedin_accounts (user_id, display_name, status, owner_member_id, last_sync_status, staged_count)
    values (v_user, 'Demo Account', 'connected', 'demo-owner-' || v_user::text, 'succeeded', 0)
    returning id into v_account;
  else
    update public.linkedin_accounts set status = 'connected' where id = v_account;
  end if;

  -- Mock leads (idempotent on account_id + profile_url). No enrichment is faked
  -- here — in the real flow the profile is retrieved automatically on save.
  insert into public.leads
    (account_id, profile_url, provider_member_id, first_name, last_name, headline,
     current_company, current_title, location, industry, email, known)
  values
    (v_account, 'https://www.linkedin.com/in/demo-sara',    'demo1', 'Sara',  'El Amrani',   'Head of Growth @ Nimbus',   'Nimbus',  'Head of Growth',  'Casablanca, MA', 'SaaS',        'sara@nimbus.io',        true),
    (v_account, 'https://www.linkedin.com/in/demo-yassine', 'demo2', 'Yassine','Berrada',    'Founder & CEO @ Palmier',   'Palmier', 'Founder & CEO',   'Rabat, MA',      'Fintech',     'yassine@palmier.co',    false),
    (v_account, 'https://www.linkedin.com/in/demo-lina',    'demo3', 'Lina',  'Haddad',      'VP Sales @ Cedar',          'Cedar',   'VP Sales',        'Paris, FR',      'B2B Software', null,                   false),
    (v_account, 'https://www.linkedin.com/in/demo-omar',    'demo4', 'Omar',  'Fassi',       'Product Manager @ Atlas',   'Atlas',   'Product Manager', 'Marrakech, MA',  'E-commerce',  'omar.fassi@atlas.shop', true),
    (v_account, 'https://www.linkedin.com/in/demo-nadia',   'demo5', 'Nadia', 'Cherkaoui',   'CTO @ Wafr',                'Wafr',    'CTO',             'Tangier, MA',    'AI',          'nadia@wafr.ai',         false)
  on conflict (account_id, profile_url) do nothing;

  raise notice 'Seeded demo account % with mock leads.', v_account;
end $$;
