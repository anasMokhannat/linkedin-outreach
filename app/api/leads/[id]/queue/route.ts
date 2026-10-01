import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * POST /api/leads/:id/queue  { body?, action?: 'queue' | 'unqueue' }
 * Moves this lead's latest generated message between draft and queued WITHOUT
 * sending it. Queued messages are later sent by the scheduler (/api/cron/auto-send)
 * during business hours, respecting the daily/weekly caps. Account-scoped.
 *
 * - action 'queue'   (default): draft → queued (saving the current body).
 * - action 'unqueue'         : queued → draft (cancel, keep editing).
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const b = (await req.json().catch(() => ({}))) as { body?: unknown; action?: unknown };
    const action = b.action === 'unqueue' ? 'unqueue' : 'queue';
    const text = typeof b.body === 'string' ? b.body.trim() : '';

    const svc = createSupabaseServiceClient();

    // Confirm the lead belongs to this account.
    const { data: lead } = await svc
      .from('leads')
      .select('id')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!lead) throw new HttpError(404, 'Lead not found.');

    const fromStatus = action === 'queue' ? 'draft' : 'queued';
    const toStatus = action === 'queue' ? 'queued' : 'draft';

    const { data: msg } = await svc
      .from('messages')
      .select('id')
      .eq('account_id', accountId)
      .eq('lead_id', lead.id)
      .eq('status', fromStatus)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (msg) {
      const patch: Record<string, unknown> = { status: toStatus };
      if (action === 'queue' && text) patch.body = text;
      const { error } = await svc.from('messages').update(patch).eq('id', msg.id);
      if (error) throw new Error(error.message);
    } else if (action === 'queue' && text) {
      // No draft on record yet — create the queued message directly.
      const { error } = await svc
        .from('messages')
        .insert({ account_id: accountId, lead_id: lead.id, body: text, status: 'queued' });
      if (error) throw new Error(error.message);
    } else {
      throw new HttpError(404, action === 'queue' ? 'No draft to queue.' : 'No queued message to cancel.');
    }

    return json({ ok: true, status: toStatus });
  } catch (err) {
    return errorResponse(err);
  }
}
