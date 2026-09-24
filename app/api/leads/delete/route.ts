import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * POST /api/leads/delete  { leadIds[] } — remove several leads at once.
 * Account-scoped. `messages`/enrichment go with the lead (cascade / on-row), but
 * `notifications` use ON DELETE SET NULL, so we clear those explicitly first.
 */
export async function POST(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const body = (await req.json().catch(() => ({}))) as { leadIds?: unknown };
    const leadIds = Array.isArray(body.leadIds)
      ? (body.leadIds as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    if (leadIds.length === 0) throw new HttpError(400, 'No leads selected.');

    const svc = createSupabaseServiceClient();
    await svc.from('notifications').delete().eq('account_id', accountId).in('lead_id', leadIds);
    const { error } = await svc.from('leads').delete().eq('account_id', accountId).in('id', leadIds);
    if (error) throw new Error(error.message);

    return json({ ok: true, deleted: leadIds.length });
  } catch (err) {
    return errorResponse(err);
  }
}
