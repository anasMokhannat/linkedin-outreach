import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { getUsage, DAILY_MESSAGE_LIMIT, WEEKLY_MESSAGE_LIMIT } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/campaigns/:id — campaign + its leads (with message + status) + usage. */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data: campaign } = await svc
      .from('campaigns')
      .select('*')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!campaign) throw new HttpError(404, 'Campaign not found.');

    const { data: rows } = await svc
      .from('campaign_leads')
      .select('id, lead_id, status, error, sent_at, leads(first_name, last_name, current_title, current_company, profile_url), messages(body, status)')
      .eq('campaign_id', params.id)
      .order('created_at', { ascending: true });

    const usage = await getUsage(accountId);

    return json({
      campaign,
      leads: rows ?? [],
      usage,
      limits: { daily: DAILY_MESSAGE_LIMIT, weekly: WEEKLY_MESSAGE_LIMIT },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/campaigns/:id */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const { error } = await svc.from('campaigns').delete().eq('id', params.id).eq('account_id', accountId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
