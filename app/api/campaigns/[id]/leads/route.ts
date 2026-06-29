import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/** POST /api/campaigns/:id/leads  { leadIds[] } — add leads to an existing campaign. */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const body = (await req.json().catch(() => ({}))) as { leadIds?: unknown };
    const leadIds = Array.isArray(body.leadIds) ? (body.leadIds as string[]).filter((x) => typeof x === 'string') : [];
    if (leadIds.length === 0) throw new HttpError(400, 'No leads selected.');

    const svc = createSupabaseServiceClient();
    const { data: campaign } = await svc
      .from('campaigns')
      .select('id')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!campaign) throw new HttpError(404, 'Campaign not found.');

    const { data: leads } = await svc
      .from('leads')
      .select('id')
      .eq('account_id', accountId)
      .in('id', leadIds);
    const rows = (leads ?? []).map((l) => ({
      campaign_id: params.id,
      account_id: accountId,
      lead_id: l.id,
      status: 'pending' as const,
    }));
    if (rows.length === 0) throw new HttpError(400, 'No valid leads.');

    // Ignore leads already in the campaign (unique campaign_id, lead_id).
    const { data, error } = await svc
      .from('campaign_leads')
      .upsert(rows, { onConflict: 'campaign_id,lead_id', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(error.message);

    return json({ ok: true, added: data?.length ?? 0 });
  } catch (err) {
    return errorResponse(err);
  }
}
