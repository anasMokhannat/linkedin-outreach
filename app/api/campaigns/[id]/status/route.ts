import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * PATCH /api/campaigns/:id/status  { action: 'activate' | 'pause' }
 *
 * Activate = approve all generated messages and start sending (throttled by the
 * daily cron). Pause = stop sending; in-flight stays as is.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const { action } = (await req.json().catch(() => ({}))) as { action?: string };
    const svc = createSupabaseServiceClient();

    const { data: campaign } = await svc
      .from('campaigns')
      .select('id, status')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!campaign) throw new HttpError(404, 'Campaign not found.');

    if (action === 'activate') {
      // Approve all generated messages and mark their campaign_leads approved.
      const { data: gens } = await svc
        .from('campaign_leads')
        .select('id, message_id')
        .eq('campaign_id', params.id)
        .eq('status', 'generated');
      const msgIds = (gens ?? []).map((g) => g.message_id).filter(Boolean) as string[];
      if (msgIds.length === 0) throw new HttpError(400, 'Generate messages before activating.');

      await svc.from('messages').update({ status: 'approved', approved_at: new Date().toISOString() }).in('id', msgIds);
      await svc.from('campaign_leads').update({ status: 'approved' }).eq('campaign_id', params.id).eq('status', 'generated');
      await svc.from('campaigns').update({ status: 'active' }).eq('id', params.id);
      return json({ ok: true, status: 'active', approved: msgIds.length });
    }

    if (action === 'pause') {
      await svc.from('campaigns').update({ status: 'paused' }).eq('id', params.id);
      return json({ ok: true, status: 'paused' });
    }

    throw new HttpError(400, 'Unknown action.');
  } catch (err) {
    return errorResponse(err);
  }
}
