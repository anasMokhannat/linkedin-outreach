import { type NextRequest } from 'next/server';
import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/notifications — recent reply notifications + unread count. */
export async function GET() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data, error } = await svc
      .from('notifications')
      .select('id, lead_id, body, read, created_at, leads(first_name, last_name)')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(30);
    if (error) throw new Error(error.message);

    const { count: unread } = await svc
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('account_id', accountId)
      .eq('read', false);

    const items = (data ?? []).map((n) => ({
      id: n.id,
      leadId: n.lead_id,
      body: n.body,
      read: n.read,
      createdAt: n.created_at,
      leadName:
        [(n.leads as { first_name?: string } | null)?.first_name, (n.leads as { last_name?: string } | null)?.last_name]
          .filter(Boolean)
          .join(' ') || 'A lead',
    }));
    return json({ items, unread: unread ?? 0 });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/notifications/read  { id? } — mark one (or all) as read. */
export async function POST(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const { id } = (await req.json().catch(() => ({}))) as { id?: string };
    const svc = createSupabaseServiceClient();
    let q = svc.from('notifications').update({ read: true }).eq('account_id', accountId).eq('read', false);
    if (id) q = q.eq('id', id);
    const { error } = await q;
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
