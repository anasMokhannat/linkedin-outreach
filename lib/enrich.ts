import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  unipileGetProfile,
  unipileGetPosts,
  unipileGetCompany,
  deriveIdentifier,
  isUnipileAuthError,
} from './unipile';

export class LeadAuthError extends Error {}

interface LeadRow {
  id: string;
  profile_url: string | null;
  provider_member_id: string | null;
}

/**
 * Full enrichment for one lead via Unipile: profile (role, company, location,
 * school, industry, email if exposed) + recent posts. Persists everything —
 * both the basic fields and the enrichment detail (summary, experiences,
 * education, skills, company, recent_posts, raw) — directly onto the lead row.
 * Returns true on success, false when no identifier is available. Throws
 * LeadAuthError when the LinkedIn session needs reconnecting.
 */
export async function enrichLead(
  svc: SupabaseClient,
  accountId: string,
  unipileAccountId: string,
  lead: LeadRow
): Promise<boolean> {
  const identifier = deriveIdentifier(lead.provider_member_id, lead.profile_url);
  if (!identifier) return false;

  let profile, posts;
  try {
    [profile, posts] = await Promise.all([
      unipileGetProfile(unipileAccountId, identifier),
      unipileGetPosts(unipileAccountId, identifier, 5),
    ]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'enrichment failed';
    if (isUnipileAuthError(msg)) throw new LeadAuthError(msg);
    throw err;
  }

  const patch: Record<string, unknown> = {
    enriched_at: new Date().toISOString(),
    // Enrichment detail — now stored on the lead row itself (no lead_enrichment).
    summary: profile.summary ?? null,
    experiences: profile.experiences,
    education: profile.education,
    skills: profile.skills,
    company: profile.currentCompany
      ? { name: profile.currentCompany, title: profile.currentTitle }
      : null,
    recent_posts: posts,
    raw: profile.raw,
  };
  if (profile.currentCompany) patch.current_company = profile.currentCompany;
  if (profile.currentTitle) patch.current_title = profile.currentTitle;
  if (profile.location) patch.location = profile.location;
  if (profile.school) patch.school = profile.school;
  if (profile.industry) patch.industry = profile.industry;
  if (profile.headline) patch.headline = profile.headline;
  if (profile.email) patch.email = profile.email;

  // Best-effort company retrieval (sector + size tier for the playbook).
  if (profile.currentCompanyId) {
    const company = await unipileGetCompany(unipileAccountId, profile.currentCompanyId);
    if (company) {
      if (typeof company.employeeCount === 'number') patch.company_size = company.employeeCount;
      // Prefer the company's classified industry over the person-level one.
      if (company.industry) patch.industry = company.industry;
    }
  }

  await svc.from('leads').update(patch).eq('id', lead.id).eq('account_id', accountId);

  return true;
}
