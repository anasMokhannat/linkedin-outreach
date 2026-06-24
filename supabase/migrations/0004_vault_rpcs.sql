-- 0004_vault_rpcs.sql
-- Wrap Supabase Vault access in SECURITY DEFINER RPCs so the application only
-- ever touches the li_at cookie through a narrow, auditable surface.
--
-- These are callable only by the service role (revoked from anon/authenticated),
-- matching the rule that the cookie is handled server-side just-in-time and
-- never reaches the browser.
--
-- Requires the Supabase Vault extension to be enabled in the project.

-- Create/store a secret, returning its uuid id.
create or replace function public.app_create_li_secret(p_user_id uuid, p_secret text)
returns uuid
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_id uuid;
begin
  -- Name the secret per user+timestamp; description aids auditing in Vault UI.
  select vault.create_secret(
    p_secret,
    'li_at:' || p_user_id::text || ':' || extract(epoch from now())::bigint::text,
    'LinkedIn li_at session cookie'
  ) into v_id;
  return v_id;
end;
$$;

-- Read back the decrypted secret by id.
create or replace function public.app_read_li_secret(p_secret_id uuid)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where id = p_secret_id;
  return v_secret;
end;
$$;

-- Delete a secret by id (used on disconnect / reauth replacement).
create or replace function public.app_delete_li_secret(p_secret_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
begin
  delete from vault.secrets where id = p_secret_id;
end;
$$;

-- Lock down: only the service role may call these.
revoke all on function public.app_create_li_secret(uuid, text) from public, anon, authenticated;
revoke all on function public.app_read_li_secret(uuid) from public, anon, authenticated;
revoke all on function public.app_delete_li_secret(uuid) from public, anon, authenticated;
grant execute on function public.app_create_li_secret(uuid, text) to service_role;
grant execute on function public.app_read_li_secret(uuid) to service_role;
grant execute on function public.app_delete_li_secret(uuid) to service_role;
