import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/settings — account email, writer role + LinkedIn connection status. */
export async function GET() {
  try {
    const userId = await requireUserId();
    const svc = createSupabaseServiceClient();

    // Independent lookups → run in parallel.
    const [{ data: user }, { data: account }] = await Promise.all([
      svc.from('users').select('email, company_name, writer_role').eq('id', userId).maybeSingle(),
      svc.from('linkedin_accounts').select('status, display_name, last_validated').eq('user_id', userId).maybeSingle(),
    ]);

    return json({ user: user ?? {}, linkedin: account ?? { status: 'disconnected' } });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH /api/settings  { writerRole } — update the sender nature (associate|partner). */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = (await req.json().catch(() => ({}))) as { writerRole?: unknown };
    if (body.writerRole !== 'associate' && body.writerRole !== 'partner') {
      throw new HttpError(400, 'Invalid writer role.');
    }
    const svc = createSupabaseServiceClient();
    const { error } = await svc.from('users').update({ writer_role: body.writerRole }).eq('id', userId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
