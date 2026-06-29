import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { MESSAGE_HARD_CAP } from '@/lib/openrouter';

export const runtime = 'nodejs';

/**
 * PATCH /api/campaigns/:id/review  { campaignLeadId, action: 'approve'|'edit'|'skip', body? }
 * Per-message review inside a campaign. Keeps campaign_leads.status in sync with
 * the underlying message status.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const b = (await req.json().catch(() => ({}))) as { campaignLeadId?: string; action?: string; body?: string };
    if (!b.campaignLeadId) throw new HttpError(400, 'campaignLeadId required.');

    const svc = createSupabaseServiceClient();
    const { data: cl } = await svc
      .from('campaign_leads')
      .select('id, message_id, status')
      .eq('id', b.campaignLeadId)
      .eq('campaign_id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!cl) throw new HttpError(404, 'Campaign lead not found.');

    if (b.action === 'approve') {
      if (!cl.message_id) throw new HttpError(400, 'No message generated yet.');
      await svc.from('messages').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', cl.message_id);
      await svc.from('campaign_leads').update({ status: 'approved' }).eq('id', cl.id);
      return json({ ok: true, status: 'approved' });
    }

    if (b.action === 'skip') {
      if (cl.message_id) await svc.from('messages').update({ status: 'rejected' }).eq('id', cl.message_id);
      await svc.from('campaign_leads').update({ status: 'skipped' }).eq('id', cl.id);
      return json({ ok: true, status: 'skipped' });
    }

    if (b.action === 'edit') {
      if (!cl.message_id) throw new HttpError(400, 'No message to edit.');
      const body = (b.body ?? '').trim();
      if (!body) throw new HttpError(400, 'Empty message.');
      if (body.length > MESSAGE_HARD_CAP) throw new HttpError(400, `Message exceeds ${MESSAGE_HARD_CAP} characters.`);
      // Editing reverts to draft/generated so it must be re-approved.
      await svc.from('messages').update({ body, edited_by_user: true, status: 'draft', approved_at: null }).eq('id', cl.message_id);
      await svc.from('campaign_leads').update({ status: 'generated' }).eq('id', cl.id);
      return json({ ok: true, status: 'generated' });
    }

    throw new HttpError(400, 'Unknown action.');
  } catch (err) {
    return errorResponse(err);
  }
}
