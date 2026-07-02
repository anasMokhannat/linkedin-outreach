import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { enrichLead, LeadAuthError } from '@/lib/enrich';

export const runtime = 'nodejs';

/**
 * POST /api/leads/:id/enrich
 * Full enrichment via Unipile (synchronous): profile, experience, education,
 * skills, recent posts, and email (when exposed). See lib/enrich.ts.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data: lead } = await svc
      .from('leads')
      .select('id, profile_url, provider_member_id')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!lead) throw new HttpError(404, 'Lead not found.');

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('unipile_account_id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.unipile_account_id) throw new HttpError(400, 'No LinkedIn account connected.');

    try {
      const ok = await enrichLead(svc, accountId, account.unipile_account_id, lead);
      if (!ok) throw new HttpError(422, 'Cannot determine a profile identifier for this lead.');
    } catch (err) {
      if (err instanceof LeadAuthError) {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('id', accountId);
        throw new HttpError(409, 'LinkedIn session needs reconnecting.');
      }
      throw err;
    }

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
