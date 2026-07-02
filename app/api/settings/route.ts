import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COMPANY_FIELDS = [
  'company_name',
  'company_description',
  'company_services',
  'company_usps',
  'company_pain_points',
] as const;

/** GET /api/settings — company context (for AI) + linkedin connection status. */
export async function GET() {
  try {
    const userId = await requireUserId();
    const svc = createSupabaseServiceClient();

    const { data: user } = await svc
      .from('users')
      .select('email, company_name, company_description, company_services, company_usps, company_pain_points')
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

/** PATCH /api/settings — update the company context fields. */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const update: Record<string, unknown> = {};
    for (const f of COMPANY_FIELDS) {
      if (typeof b[f] === 'string') update[f] = (b[f] as string).slice(0, 4000);
    }
    if (Object.keys(update).length === 0) throw new HttpError(400, 'Nothing to update.');

    const svc = createSupabaseServiceClient();
    const { error } = await svc.from('users').update(update).eq('id', userId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
