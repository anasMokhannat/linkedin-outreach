import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * POST /api/data { action: 'purge_raw_enrichment' | 'delete_all' } — account-scoped
 * data minimization controls.
 */
export async function POST(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const { action } = (await req.json().catch(() => ({}))) as { action?: string };
    const svc = createSupabaseServiceClient();

    if (action === 'purge_raw_enrichment') {
      const { error } = await svc
        .from('lead_enrichment')
        .update({ raw: null })
        .eq('account_id', accountId)
        .not('raw', 'is', null);
      if (error) throw new Error(error.message);
      return json({ ok: true, purged: 'raw' });
    }

    if (action === 'delete_all') {
      await svc.from('send_log').delete().eq('account_id', accountId);
      const { error } = await svc.from('leads').delete().eq('account_id', accountId);
      if (error) throw new Error(error.message);
      return json({ ok: true, deleted: 'all' });
    }

    throw new HttpError(400, 'Unknown action.');
  } catch (err) {
    return errorResponse(err);
  }
}
