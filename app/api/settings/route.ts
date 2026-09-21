import { requireUserId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/settings — account email + LinkedIn connection status. */
export async function GET() {
  try {
    const userId = await requireUserId();
    const svc = createSupabaseServiceClient();

    // Independent lookups → run in parallel.
    const [{ data: user }, { data: account }] = await Promise.all([
      svc.from('users').select('email, company_name').eq('id', userId).maybeSingle(),
      svc.from('linkedin_accounts').select('status, display_name, last_validated').eq('user_id', userId).maybeSingle(),
    ]);

    return json({ user: user ?? {}, linkedin: account ?? { status: 'disconnected' } });
  } catch (err) {
    return errorResponse(err);
  }
}
