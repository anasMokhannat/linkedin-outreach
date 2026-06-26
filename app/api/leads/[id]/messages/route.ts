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
      .select('id, body, status, model, sent_at, created_at')
      .eq('account_id', accountId)
      .eq('lead_id', params.id)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return json({ messages: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}
