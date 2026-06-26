import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/settings — the two configurable numbers + account status. */
export async function GET() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const { data } = await svc
      .from('linkedin_accounts')
      .select('status, display_name, dms_per_day, leads_to_message, last_validated')
      .eq('id', accountId)
      .maybeSingle();
    return json({ settings: data ?? {} });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH /api/settings — update messages/day and leads-to-message. */
export async function PATCH(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);

    const update: Record<string, unknown> = {};
    if (num(b.dms_per_day) !== undefined) update.dms_per_day = Math.min(200, Math.max(1, num(b.dms_per_day)!));
    if (num(b.leads_to_message) !== undefined)
      update.leads_to_message = Math.min(100000, Math.max(0, num(b.leads_to_message)!));
    if (Object.keys(update).length === 0) throw new HttpError(400, 'Nothing to update.');

    const svc = createSupabaseServiceClient();
    const { error } = await svc.from('linkedin_accounts').update(update).eq('id', accountId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
