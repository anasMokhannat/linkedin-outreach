import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { startActorRun, residentialProxy } from '@/lib/apify';
import { serverEnv } from '@/lib/env';

export const runtime = 'nodejs';

/**
 * POST /api/leads/:id/enrich
 *
 * Cookieless enrichment (spec §1 "minimize cookie usage"): starts the profile +
 * posts actors (and optionally the company actor) on the lead's public profile.
 * NO session cookie is used here — zero account risk, no quota burn.
 *
 * Each actor run is async and reports back via the webhook, which merges results
 * into lead_enrichment and fills the lead's Tier-2 fields.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const leadId = params.id;

    // RLS-scoped read ensures the lead belongs to this user.
    const supabase = createSupabaseServerClient();
    const { data: lead } = await supabase
      .from('leads')
      .select('id, profile_url')
      .eq('id', leadId)
      .maybeSingle();
    if (!lead) throw new HttpError(404, 'Lead not found.');

    const correlation = { userId, action: 'enrich', leadId };
    const proxy = residentialProxy(null); // cookieless: generic proxy is fine

    const started: string[] = [];

    // Profile (covers Tier-2: location, school, industry, role, company).
    const profileRun = await startActorRun('profile', {
      input: {
        // TODO(confirm): exact input schema of APIFY_ACTOR_PROFILE.
        profileUrls: [lead.profile_url],
        urls: [lead.profile_url],
        proxy,
      },
      webhookPayload: correlation,
    });
    started.push(profileRun.runId);

    // Recent posts (personalization basis).
    const postsRun = await startActorRun('posts', {
      input: {
        // TODO(confirm): exact input schema of APIFY_ACTOR_POSTS.
        profileUrls: [lead.profile_url],
        urls: [lead.profile_url],
        maxPosts: 5,
        proxy,
      },
      webhookPayload: correlation,
    });
    started.push(postsRun.runId);

    // Company page is optional; only run if explicitly configured (spec §5).
    if (serverEnv.actorCompany()) {
      try {
        const companyRun = await startActorRun('company', {
          input: { profileUrls: [lead.profile_url], proxy },
          webhookPayload: correlation,
        });
        started.push(companyRun.runId);
      } catch {
        /* company actor optional — ignore start failures */
      }
    }

    return json({ ok: true, runs: started.length });
  } catch (err) {
    return errorResponse(err);
  }
}
