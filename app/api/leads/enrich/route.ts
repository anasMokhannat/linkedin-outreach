import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { enrichLead, LeadAuthError } from '@/lib/enrich';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Small, slow batches: keeps the call short (never times out) AND gentle on
// LinkedIn — retrieving too many profiles at once makes LinkedIn "throttle" the
// experience section (returns profiles without company/title). The client calls
// this repeatedly until `remaining` reaches 0.
const BATCH = 3;
const MAX_ATTEMPTS = 3; // cap retries of a stubbornly-throttled lead
const RETRY_AFTER_MS = 6 * 60 * 60 * 1000; // re-enrich a throttled lead after 6h (throttle resets)

/**
 * POST /api/leads/enrich — enrich a small batch. A lead is "to enrich" when it
 * was never enriched, OR it came back partial (experience throttled) and is due
 * for another attempt (older than 6h, under the attempt cap).
 */
export async function POST() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    // PostgREST filter: enrich_status IS NULL OR (partial AND attempts<cap AND stale).
    // Drop milliseconds so the value carries no "." (keeps the or()/and() parser happy).
    const cutoff = new Date(Date.now() - RETRY_AFTER_MS).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const toEnrichFilter = `enrich_status.is.null,and(enrich_status.eq.partial,enrich_attempts.lt.${MAX_ATTEMPTS},enriched_at.lt.${cutoff})`;

    const countRemaining = async () => {
      const { count } = await svc
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .or(toEnrichFilter);
      return count ?? 0;
    };

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('unipile_account_id, status')
      .eq('id', accountId)
      .maybeSingle();

    if (!account?.unipile_account_id || account.status !== 'connected') {
      return json({ enriched: 0, remaining: await countRemaining(), connected: false });
    }

    const { data: batch } = await svc
      .from('leads')
      .select('id, profile_url, provider_member_id, enrich_attempts')
      .eq('account_id', accountId)
      .or(toEnrichFilter)
      .order('enriched_at', { ascending: true, nullsFirst: true }) // never-enriched first
      .limit(BATCH);

    let enriched = 0;
    let authError = false;

    if (batch && batch.length > 0) {
      // Enrich the batch concurrently but with staggered starts — gentle on the
      // provider limits. 429s are retried inside uFetch.
      const results = await Promise.allSettled(
        batch.map(async (lead, i) => {
          await new Promise((r) => setTimeout(r, i * 500));
          return enrichLead(svc, accountId, account.unipile_account_id as string, lead);
        })
      );
      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value) enriched++;
        } else if (r.reason instanceof LeadAuthError) {
          authError = true;
        } else {
          log.warn('leads', 'enrich failed', { err: r.reason instanceof Error ? r.reason.message : 'unknown' });
        }
      }
      if (authError) {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('id', accountId);
      }
    }

    return json({ enriched, remaining: await countRemaining(), connected: true, authError });
  } catch (err) {
    return errorResponse(err);
  }
}
