import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/campaigns — list with per-campaign lead/sent counts. */
export async function GET() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data: campaigns, error } = await svc
      .from('campaigns')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const { data: cl } = await svc
      .from('campaign_leads')
      .select('campaign_id, status')
      .eq('account_id', accountId);

    const stats = new Map<string, { total: number; sent: number }>();
    (cl ?? []).forEach((r) => {
      const s = stats.get(r.campaign_id) ?? { total: 0, sent: 0 };
      s.total += 1;
      if (r.status === 'sent') s.sent += 1;
      stats.set(r.campaign_id, s);
    });

    return json({
      campaigns: (campaigns ?? []).map((c) => ({
        ...c,
        leadCount: stats.get(c.id)?.total ?? 0,
        sentCount: stats.get(c.id)?.sent ?? 0,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/campaigns  { name, cta, offer, leadIds[] } — create a draft campaign. */
export async function POST(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const body = (await req.json().catch(() => ({}))) as {
      name?: unknown;
      cta?: unknown;
      offer?: unknown;
      leadIds?: unknown;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const cta = typeof body.cta === 'string' ? body.cta.trim() : '';
    const offer = typeof body.offer === 'string' ? body.offer.trim() : '';
    const leadIds = Array.isArray(body.leadIds) ? (body.leadIds as string[]).filter((x) => typeof x === 'string') : [];
    if (!name) throw new HttpError(400, 'Campaign name is required.');
    if (leadIds.length === 0) throw new HttpError(400, 'Select at least one lead.');

    const svc = createSupabaseServiceClient();

    // Validate the leads belong to this account.
    const { data: leads } = await svc
      .from('leads')
      .select('id')
      .eq('account_id', accountId)
      .in('id', leadIds);
    const valid = (leads ?? []).map((l) => l.id);
    if (valid.length === 0) throw new HttpError(400, 'No valid leads selected.');

    const { data: campaign, error } = await svc
      .from('campaigns')
      .insert({ account_id: accountId, name, cta, offer, status: 'draft' })
      .select('*')
      .single();
    if (error || !campaign) throw new Error(error?.message ?? 'Failed to create campaign');

    const rows = valid.map((leadId) => ({
      campaign_id: campaign.id,
      account_id: accountId,
      lead_id: leadId,
      status: 'pending' as const,
    }));
    const { error: clErr } = await svc.from('campaign_leads').insert(rows);
    if (clErr) throw new Error(clErr.message);

    return json({ ok: true, campaign, leads: valid.length });
  } catch (err) {
    return errorResponse(err);
  }
}
