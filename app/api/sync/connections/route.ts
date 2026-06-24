import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { readCookie } from '@/lib/vault';
import { startActorRun, residentialProxy } from '@/lib/apify';

export const runtime = 'nodejs';

/**
 * POST /api/sync/connections
 *
 * Starts the cookie-based connections actor. The li_at cookie is decrypted
 * just-in-time, handed to Apify server-side, and never returned to the client.
 * Results land in an Apify dataset (transient staging) — we store only the
 * dataset id pointer; raw connections are never persisted in our DB.
 *
 * Async: we start the run and register a webhook. We never poll to completion.
 */
export async function POST() {
  try {
    const userId = await requireUserId();
    const svc = createSupabaseServiceClient();

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('id, li_secret_id, status, proxy_country')
      .eq('user_id', userId)
      .maybeSingle();

    if (!account || !account.li_secret_id) {
      throw new HttpError(400, 'No LinkedIn session connected.');
    }
    if (account.status !== 'connected') {
      throw new HttpError(409, 'Session needs reconnecting before syncing.');
    }

    // Just-in-time decrypt; the cookie lives only in this request's memory.
    const liAt = await readCookie(account.li_secret_id);

    const run = await startActorRun('connections', {
      input: {
        // Field names per the connections actor; cookie passed as a session cookie.
        // TODO(confirm): exact input schema of APIFY_ACTOR_CONNECTIONS.
        cookie: [{ name: 'li_at', value: liAt, domain: '.linkedin.com' }],
        li_at: liAt,
        proxy: residentialProxy(account.proxy_country),
        maxResults: 5000,
      },
      proxyCountry: account.proxy_country,
      webhookPayload: { userId, action: 'sync_connections', accountId: account.id },
    });

    await svc
      .from('linkedin_accounts')
      .update({
        last_sync_run_id: run.runId,
        last_sync_dataset_id: run.defaultDatasetId,
        last_sync_status: 'running',
        last_sync_at: new Date().toISOString(),
      })
      .eq('user_id', userId);

    return json({ ok: true, runId: run.runId, status: 'running' });
  } catch (err) {
    return errorResponse(err);
  }
}
