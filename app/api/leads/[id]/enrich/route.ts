import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import {
  unipileGetProfile,
  unipileGetPosts,
  deriveIdentifier,
  isUnipileAuthError,
} from '@/lib/unipile';

export const runtime = 'nodejs';

/**
 * POST /api/leads/:id/enrich
 *
 * Full enrichment via Unipile (synchronous): profile (role, company, location,
 * school), full work experience, education, skills, and recent posts. Stored in
 * lead_enrichment; key Tier-2 fields copied onto the lead.
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

    const identifier = deriveIdentifier(lead.provider_member_id, lead.profile_url);
    if (!identifier) throw new HttpError(422, 'Cannot determine a profile identifier for this lead.');

    let profile, posts;
    try {
      [profile, posts] = await Promise.all([
        unipileGetProfile(account.unipile_account_id, identifier),
        unipileGetPosts(account.unipile_account_id, identifier, 5),
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'enrichment failed';
      if (isUnipileAuthError(msg)) {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('id', accountId);
        throw new HttpError(409, 'LinkedIn session needs reconnecting.');
      }
      throw err;
    }

    await svc.from('lead_enrichment').upsert(
      {
        lead_id: lead.id,
        account_id: accountId,
        summary: profile.summary ?? null,
        experiences: profile.experiences,
        education: profile.education,
        skills: profile.skills,
        company: profile.currentCompany
          ? { name: profile.currentCompany, title: profile.currentTitle }
          : null,
        recent_posts: posts,
        raw: profile.raw,
      },
      { onConflict: 'lead_id' }
    );

    const patch: Record<string, unknown> = { enriched_at: new Date().toISOString() };
    if (profile.currentCompany) patch.current_company = profile.currentCompany;
    if (profile.currentTitle) patch.current_title = profile.currentTitle;
    if (profile.location) patch.location = profile.location;
    if (profile.school) patch.school = profile.school;
    if (profile.industry) patch.industry = profile.industry;
    if (profile.headline) patch.headline = profile.headline;
    await svc.from('leads').update(patch).eq('id', lead.id).eq('account_id', accountId);

    return json({ ok: true, posts: posts.length, experiences: profile.experiences.length });
  } catch (err) {
    return errorResponse(err);
  }
}
