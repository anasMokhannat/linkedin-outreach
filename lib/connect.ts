import 'server-only';
import { NextResponse } from 'next/server';
import { HttpError } from './auth';
import { createSupabaseServiceClient } from './supabase-server';
import { unipileWaitForAccount } from './unipile';
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
export async function finalizeConnection(unipileAccountId: string, country: string | null) {
  const state = await unipileWaitForAccount(unipileAccountId);

  if (state === 'GONE') {
    log.warn('connect', 'account gone', { unipileAccountId });
    throw new HttpError(409, 'LinkedIn connection failed — please try connecting again.');
  }

  if (state !== 'OK') {
    // Pending checkpoint / in-app approval — keep waiting (no session yet).
    log.info('connect', 'await approval', { unipileAccountId, state });
    return NextResponse.json({ status: 'await_approval', accountId: unipileAccountId });
  }

  const svc = createSupabaseServiceClient();
  const { data: account, error } = await svc
    .from('linkedin_accounts')
    .upsert(
      {
        unipile_account_id: unipileAccountId,
        status: 'connected',
        proxy_country: country,
        last_validated: new Date().toISOString(),
      },
      { onConflict: 'unipile_account_id' }
    )
    .select('id')
    .single();
  if (error || !account) throw new Error(error?.message ?? 'Failed to persist account');

  await svc.from('send_log').insert({
    account_id: account.id,
    event: 'session_connected',
    detail: { provider: 'unipile' },
  });
  log.info('connect', 'connected', { accountId: account.id });

  const res = NextResponse.json({ status: 'connected' });
  res.cookies.set(SESSION_COOKIE, signSession(account.id), sessionCookieOptions());
  return res;
}
