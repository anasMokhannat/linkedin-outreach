import 'server-only';
import { NextResponse } from 'next/server';
import { HttpError } from './auth';
import { createSupabaseServiceClient } from './supabase-server';
import { unipileWaitForAccount, unipileGetAccountOwner } from './unipile';
import { signSession, SESSION_COOKIE, sessionCookieOptions } from './session';
import { log } from './log';

/**
 * Try to finalize a Unipile connection: poll the account state briefly.
 *  - OK    → persist the account (tenant) + set the session cookie → 'connected'.
 *  - GONE  → real failure (409).
 *  - else  → still pending (e.g. awaiting in-app 2FA approval). We do NOT delete
 *            or error; we return 'await_approval' so the client keeps polling.
 *
 * Bad credentials are already rejected earlier (POST /accounts → 401), so a
 * pending state here means a checkpoint is still being completed, not bad creds.
 */
export async function finalizeConnection(
  unipileAccountId: string,
  country: string | null,
  opts: { tolerateGone?: boolean } = {}
) {
  const state = await unipileWaitForAccount(unipileAccountId);

  if (state === 'GONE') {
    // While polling an in-app checkpoint, the account can briefly 404 before the
    // user approves — treat that as still-pending rather than a hard failure.
    if (opts.tolerateGone) {
      log.info('connect', 'await approval (gone, tolerated)', { unipileAccountId });
      return NextResponse.json({ status: 'await_approval', accountId: unipileAccountId });
    }
    log.warn('connect', 'account gone', { unipileAccountId });
    throw new HttpError(409, 'LinkedIn connection failed — please try connecting again.');
  }

  if (state !== 'OK') {
    // Pending checkpoint / in-app approval — keep waiting (no session yet).
    log.info('connect', 'await approval', { unipileAccountId, state });
    return NextResponse.json({ status: 'await_approval', accountId: unipileAccountId });
  }

  const svc = createSupabaseServiceClient();

  // Tenant identity = the stable LinkedIn owner id, so reconnecting reuses the
  // same tenant (and all its leads/messages/settings) even though the Unipile
  // account_id changes each time.
  const { ownerId, name } = await unipileGetAccountOwner(unipileAccountId);
  const patch = {
    unipile_account_id: unipileAccountId,
    owner_member_id: ownerId,
    display_name: name,
    status: 'connected' as const,
    proxy_country: country,
    last_validated: new Date().toISOString(),
  };

  let accountRowId: string | undefined;
  if (ownerId) {
    const { data: existing } = await svc
      .from('linkedin_accounts')
      .select('id')
      .eq('owner_member_id', ownerId)
      .maybeSingle();
    if (existing) {
      await svc.from('linkedin_accounts').update(patch).eq('id', existing.id);
      accountRowId = existing.id;
    }
  }
  if (!accountRowId) {
    // No owner match — reuse a row for this exact unipile account if present, else create.
    const { data: byUnipile } = await svc
      .from('linkedin_accounts')
      .select('id')
      .eq('unipile_account_id', unipileAccountId)
      .maybeSingle();
    if (byUnipile) {
      await svc.from('linkedin_accounts').update(patch).eq('id', byUnipile.id);
      accountRowId = byUnipile.id;
    } else {
      const { data: created, error } = await svc
        .from('linkedin_accounts')
        .insert(patch)
        .select('id')
        .single();
      if (error || !created) throw new Error(error?.message ?? 'Failed to persist account');
      accountRowId = created.id;
    }
  }

  if (!accountRowId) throw new Error('Failed to resolve account');

  await svc.from('send_log').insert({
    account_id: accountRowId,
    event: 'session_connected',
    detail: { provider: 'unipile', ownerId },
  });
  log.info('connect', 'connected', { accountId: accountRowId, ownerId });

  const res = NextResponse.json({ status: 'connected' });
  res.cookies.set(SESSION_COOKIE, signSession(accountRowId), sessionCookieOptions());
  return res;
}
