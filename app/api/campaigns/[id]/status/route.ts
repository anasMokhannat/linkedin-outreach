import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { sendCampaignBatch } from '@/lib/campaign-sender';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * PATCH /api/campaigns/:id/status  { action }
 *  - activate : approve all generated, set active, and send a first batch now
 *               (so it doesn't only wait for the daily cron).
 *  - resume   : set active again + send a batch now.
 *  - pause    : stop sending (keeps state).
 *  - cancel   : stop the campaign entirely.
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

    if (action === 'activate' || action === 'resume') {
      if (action === 'activate') {
        // Approve any still-generated messages.
        const { data: gens } = await svc
          .from('campaign_leads')
          .select('message_id')
          .eq('campaign_id', params.id)
          .eq('status', 'generated');
        const msgIds = (gens ?? []).map((g) => g.message_id).filter(Boolean) as string[];
        if (msgIds.length) {
          await svc.from('messages').update({ status: 'approved', approved_at: new Date().toISOString() }).in('id', msgIds);
          await svc.from('campaign_leads').update({ status: 'approved' }).eq('campaign_id', params.id).eq('status', 'generated');
        }
      }
      // Need at least one approved lead to send.
      const { count } = await svc
        .from('campaign_leads')
        .select('id', { count: 'exact', head: true })
        .eq('campaign_id', params.id)
        .eq('status', 'approved');
      if (!count) throw new HttpError(400, 'Approve at least one message first.');

      await svc.from('campaigns').update({ status: 'active' }).eq('id', params.id);
      const { sent, reason } = await sendCampaignBatch(accountId, params.id, 8);
      return json({ ok: true, status: 'active', sent, reason });
    }

    if (action === 'pause') {
      await svc.from('campaigns').update({ status: 'paused' }).eq('id', params.id);
      return json({ ok: true, status: 'paused' });
    }

    if (action === 'cancel') {
      await svc.from('campaigns').update({ status: 'cancelled' }).eq('id', params.id);
      // Stop any not-yet-sent leads from sending later.
      await svc
        .from('campaign_leads')
        .update({ status: 'skipped' })
        .eq('campaign_id', params.id)
        .in('status', ['pending', 'generated', 'approved']);
      return json({ ok: true, status: 'cancelled' });
    }

    throw new HttpError(400, 'Unknown action.');
  } catch (err) {
    return errorResponse(err);
  }
}
