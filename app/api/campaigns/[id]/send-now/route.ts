import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { sendCampaignBatch } from '@/lib/campaign-sender';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * POST /api/campaigns/:id/send-now — manually send a batch of this campaign's
 * approved messages now (up to the remaining daily/weekly allowance), instead of
 * waiting for the daily cron.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const { data: campaign } = await svc
      .from('campaigns')
      .select('status')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!campaign) throw new HttpError(404, 'Campaign not found.');
    if (campaign.status !== 'active') throw new HttpError(409, 'Activate the campaign first.');

    const { sent, reason } = await sendCampaignBatch(accountId, params.id, 8);
    return json({ ok: true, sent, reason });
  } catch (err) {
    return errorResponse(err);
  }
}
