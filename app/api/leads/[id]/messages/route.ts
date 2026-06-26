import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/leads/:id/messages — messages for one lead (#4 "View messages"). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const { data, error } = await svc
      .from('messages')
      .select('id, body, status, model, sent_at, created_at, campaign_id, campaigns(name)')
      .eq('account_id', accountId)
      .eq('lead_id', params.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const messages = (data ?? []).map((m) => ({
      id: m.id,
      body: m.body,
      status: m.status,
      model: m.model,
      sent_at: m.sent_at,
      created_at: m.created_at,
      campaignName: (m.campaigns as { name?: string } | null)?.name ?? null,
    }));
    return json({ messages });
  } catch (err) {
    return errorResponse(err);
  }
}
