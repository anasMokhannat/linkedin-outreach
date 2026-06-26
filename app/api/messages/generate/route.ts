import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { generateMessage } from '@/lib/openrouter';

export const runtime = 'nodejs';

interface EnrichedPost {
  text?: string;
}

/**
 * POST /api/messages/generate  { leadId, goal? } — Gate 1.
 * Generates a personalized draft via OpenRouter grounded on the lead's role,
 * company and recent posts. Account-scoped.
 */
export async function POST(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const body = (await req.json().catch(() => ({}))) as { leadId?: string; goal?: string };
    if (!body.leadId) throw new HttpError(400, 'leadId required.');

    const svc = createSupabaseServiceClient();
    const { data: lead } = await svc
      .from('leads')
      .select('*')
      .eq('id', body.leadId)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!lead) throw new HttpError(404, 'Lead not found.');

    const { data: enrichment } = await svc
      .from('lead_enrichment')
      .select('recent_posts, company')
      .eq('lead_id', body.leadId)
      .maybeSingle();

    const posts = Array.isArray(enrichment?.recent_posts)
      ? ((enrichment!.recent_posts as EnrichedPost[]).map((p) => p.text).filter(Boolean) as string[])
      : [];

    const { body: messageBody, model } = await generateMessage({
      firstName: lead.first_name,
      lastName: lead.last_name,
      currentTitle: lead.current_title,
      currentCompany: lead.current_company,
      industry: lead.industry,
      recentPosts: posts.slice(0, 3),
      companyAbout: null,
      senderValueProp: 'I help teams like yours; reaching out to connect, not to pitch.',
      senderGoal: body.goal?.trim() || 'Start a genuine conversation.',
    });

    const { data: inserted, error } = await svc
      .from('messages')
      .insert({ account_id: accountId, lead_id: body.leadId, body: messageBody, model, status: 'draft' })
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    return json({ ok: true, message: inserted });
  } catch (err) {
    return errorResponse(err);
  }
}
