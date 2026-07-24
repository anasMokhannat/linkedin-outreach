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

    const { data: user } = await svc
      .from('users')
      .select('email, company_name')
      .eq('id', userId)
      .maybeSingle();

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('status, display_name, last_validated')
      .eq('user_id', userId)
      .maybeSingle();

    return json({ user: user ?? {}, linkedin: account ?? { status: 'disconnected' } });
  } catch (err) {
    return errorResponse(err);
  }
}
