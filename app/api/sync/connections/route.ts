import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { readCookie } from '@/lib/vault';
import { getProvider, ProviderNotImplementedError } from '@/lib/providers';

export const runtime = 'nodejs';

/**
 * POST /api/sync/connections
 *
 * Fetches the user's 1st-degree connections via the active provider
 * (LINKEDIN_PROVIDER: 'apify' cookie-based, default; or 'linkedin-api').
 *
 * Apify path is ASYNC: the run is started and a webhook finalizes it; results
 * land in a transient Apify dataset (we store only the dataset-id pointer — raw
 * connections are never persisted in our DB).
 *
 * For a future SYNC provider (official API returning results inline), the
 * results would be staged here directly — see the sync branch below.
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

    const provider = getProvider();

    // Just-in-time decrypt only if the provider needs the cookie. The cookie
    // lives only in this request's memory and is never returned to the client.
    const liAt = provider.requiresCookie ? await readCookie(account.li_secret_id) : '';

    let result;
    try {
      result = await provider.fetchConnections({
        userId,
        accountId: account.id,
        liAt,
        proxyCountry: account.proxy_country,
      });
    } catch (err) {
      if (err instanceof ProviderNotImplementedError) {
        throw new HttpError(501, err.message);
      }
      throw err;
    }

    if (result.mode === 'async') {
      await svc
        .from('linkedin_accounts')
        .update({
          last_sync_run_id: result.runId,
          last_sync_dataset_id: result.datasetId,
          last_sync_status: 'running',
          last_sync_at: new Date().toISOString(),
        })
        .eq('user_id', userId);
      return json({ ok: true, runId: result.runId, status: 'running' });
    }

    // mode === 'sync': provider returned connections inline.
    // TODO(confirm): when wiring the official-API provider, stage these for the
    // Connections page (e.g. a transient staged_connections column + matching
    // read path in GET /api/connections), respecting the data-minimization rule.
    throw new HttpError(
      501,
      'Sync-mode connection staging is not implemented yet. Use LINKEDIN_PROVIDER=apify.'
    );
  } catch (err) {
    return errorResponse(err);
  }
}
