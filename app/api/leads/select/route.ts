import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { enrichLead, LeadAuthError } from '@/lib/enrich';
import type { StagedConnection } from '@/lib/types';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Cap how many we enrich inline per request so the serverless call finishes.
// Anything beyond this stays as a saved-but-unenriched lead (the Enrich button
// re-runs it), so nothing is lost.
const ENRICH_CAP = 30;

/**
 * POST /api/leads/select  { connections: StagedConnection[] }
 * First persistence point — selected connections become leads (account-scoped),
 * then are auto-enriched (profile + email, best-effort) right away.
 */
export async function POST(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const body = (await req.json().catch(() => ({}))) as { connections?: unknown };
    if (!Array.isArray(body.connections) || body.connections.length === 0) {
      throw new HttpError(400, 'No connections selected.');
    }
    if (body.connections.length > 1000) throw new HttpError(400, 'Too many at once (max 1000).');

    const rows = (body.connections as StagedConnection[])
      .filter((c) => c && typeof c.profileUrl === 'string' && c.profileUrl)
      .map((c) => ({
        account_id: accountId,
        profile_url: c.profileUrl,
        first_name: c.firstName ?? null,
        last_name: c.lastName ?? null,
        headline: c.headline ?? null,
        current_company: c.company ?? null,
        current_title: c.title ?? null,
        provider_member_id: c.providerId ?? null,
      }));
    if (rows.length === 0) throw new HttpError(400, 'No valid connections in payload.');

    const svc = createSupabaseServiceClient();
    const { data, error } = await svc
      .from('leads')
      .upsert(rows, { onConflict: 'account_id,profile_url', ignoreDuplicates: true })
      .select('id, profile_url, provider_member_id');
    if (error) throw new Error(error.message);

    const inserted = data ?? [];

    // Auto-enrich the freshly added leads (best-effort, bounded).
    let enriched = 0;
    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('unipile_account_id')
      .eq('id', accountId)
      .maybeSingle();
    if (account?.unipile_account_id) {
      for (const lead of inserted.slice(0, ENRICH_CAP)) {
        try {
          if (await enrichLead(svc, accountId, account.unipile_account_id, lead)) enriched++;
        } catch (e) {
          if (e instanceof LeadAuthError) {
            await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('id', accountId);
            break; // session is broken — stop; leads remain saved.
          }
          log.warn('leads', 'auto-enrich failed', { leadId: lead.id });
        }
      }
    }

    return json({ ok: true, inserted: inserted.length, requested: rows.length, enriched });
  } catch (err) {
    return errorResponse(err);
  }
}
