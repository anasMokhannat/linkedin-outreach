import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { unipileListAllRelations, unipileGetAccountState } from '@/lib/unipile';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

/**
 * POST /api/sync/connections — fetch 1st-degree relations from Unipile (sync) and
 * stage them on the account row for Tier-1 filtering/selection.
 */
export async function POST() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('unipile_account_id, status')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.unipile_account_id) throw new HttpError(400, 'No LinkedIn account connected.');
    if (account.status !== 'connected') throw new HttpError(409, 'Session needs reconnecting before syncing.');

    log.info('sync', 'start', { accountId });
    let connections;
    try {
      connections = await unipileListAllRelations(account.unipile_account_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'sync failed';
      const state = await unipileGetAccountState(account.unipile_account_id);
      log.warn('sync', 'relations failed', { state, msg });
      if (state === 'CONNECTING') {
        throw new HttpError(409, 'Your LinkedIn session is still connecting — try again in a few seconds.');
      }
      if (state === 'GONE' || state === 'CREDENTIALS') {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth', last_sync_status: 'failed' }).eq('id', accountId);
        throw new HttpError(409, 'LinkedIn connection failed or expired — reconnect.');
      }
      if (/disconnected/i.test(msg)) {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth', last_sync_status: 'failed' }).eq('id', accountId);
        throw new HttpError(409, 'LinkedIn is blocking this session from browsing connections — reconnect with your country set.');
      }
      if (state === 'OK') throw new HttpError(503, 'LinkedIn returned a temporary error — please try again in a moment.');
      throw err;
    }

    await svc
      .from('linkedin_accounts')
      .update({
        staged_connections: connections,
        staged_count: connections.length,
        last_sync_status: 'succeeded',
        last_sync_at: new Date().toISOString(),
        last_validated: new Date().toISOString(),
      })
      .eq('id', accountId);

    log.info('sync', 'succeeded', { accountId, count: connections.length });
    return json({ ok: true, status: 'succeeded', count: connections.length });
  } catch (err) {
    return errorResponse(err);
  }
}
