import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { generateMessage } from '@/lib/openrouter';
import type { NormalizedPost } from '@/lib/normalize';

export const runtime = 'nodejs';

/**
 * POST /api/messages/generate  { leadId, goal? }  — Gate 1 (Request)
 *
 * Generates a personalized draft via OpenRouter, grounded on the lead's role/
 * company + recent posts and the sender's value-prop. Saves as messages.status
 * = 'draft'. The character cap is enforced server-side in the generator.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = (await req.json().catch(() => ({}))) as { leadId?: string; goal?: string };
    if (!body.leadId) throw new HttpError(400, 'leadId required.');

    const supabase = createSupabaseServerClient();

    const [{ data: lead }, { data: profile }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', body.leadId).maybeSingle(),
      supabase.from('users').select('value_prop, openrouter_model').maybeSingle(),
    ]);
    if (!lead) throw new HttpError(404, 'Lead not found.');

    const { data: enrichment } = await supabase
      .from('lead_enrichment')
      .select('recent_posts, company')
      .eq('lead_id', body.leadId)
      .maybeSingle();

    const posts = Array.isArray(enrichment?.recent_posts)
      ? (enrichment!.recent_posts as NormalizedPost[]).map((p) => p.text).filter(Boolean)
      : [];
    const companyAbout =
      enrichment?.company && typeof enrichment.company === 'object'
        ? ((enrichment.company as Record<string, unknown>).about as string | undefined)
        : undefined;

    const senderValueProp =
      profile?.value_prop?.trim() ||
      'I help teams like yours; reaching out to connect, not to pitch.';

    const { body: messageBody, model } = await generateMessage({
      firstName: lead.first_name,
      lastName: lead.last_name,
      currentTitle: lead.current_title,
      currentCompany: lead.current_company,
      industry: lead.industry,
      recentPosts: posts.slice(0, 3),
      companyAbout: companyAbout ?? null,
      senderValueProp,
      senderGoal: body.goal?.trim() || 'Start a genuine conversation.',
    }, profile?.openrouter_model);

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({
        user_id: userId,
        lead_id: body.leadId,
        body: messageBody,
        model,
        status: 'draft',
      })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    return json({ ok: true, message: inserted });
  } catch (err) {
    return errorResponse(err);
  }
}
