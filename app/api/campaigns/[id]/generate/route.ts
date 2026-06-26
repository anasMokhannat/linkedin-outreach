import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { generateMessage } from '@/lib/openrouter';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 60;

interface EnrichedPost {
  text?: string;
}

/**
 * POST /api/campaigns/:id/generate
 * Generates ONE personalized message per pending lead, grounded on the lead's
 * enrichment + the campaign's CTA (goal) and offer (value-prop).
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data: campaign } = await svc
      .from('campaigns')
      .select('id, cta, offer')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!campaign) throw new HttpError(404, 'Campaign not found.');

    // Leads still needing a message.
    const { data: pending } = await svc
      .from('campaign_leads')
      .select('id, lead_id')
      .eq('campaign_id', params.id)
      .in('status', ['pending', 'failed']);
    if (!pending || pending.length === 0) return json({ ok: true, generated: 0 });

    let generated = 0;
    for (const cl of pending) {
      const { data: lead } = await svc.from('leads').select('*').eq('id', cl.lead_id).maybeSingle();
      if (!lead) continue;
      const { data: enr } = await svc
        .from('lead_enrichment')
        .select('recent_posts')
        .eq('lead_id', cl.lead_id)
        .maybeSingle();
      const posts = Array.isArray(enr?.recent_posts)
        ? ((enr!.recent_posts as EnrichedPost[]).map((p) => p.text).filter(Boolean) as string[])
        : [];

      try {
        const { body, model } = await generateMessage({
          firstName: lead.first_name,
          lastName: lead.last_name,
          currentTitle: lead.current_title,
          currentCompany: lead.current_company,
          industry: lead.industry,
          recentPosts: posts.slice(0, 3),
          companyAbout: null,
          senderValueProp: campaign.offer || 'I help teams like yours.',
          senderGoal: campaign.cta || 'Start a genuine conversation.',
        });

        const { data: msg, error } = await svc
          .from('messages')
          .insert({ account_id: accountId, lead_id: cl.lead_id, campaign_id: campaign.id, body, model, status: 'draft' })
          .select('id')
          .single();
        if (error || !msg) throw new Error(error?.message ?? 'insert failed');

        await svc
          .from('campaign_leads')
          .update({ message_id: msg.id, status: 'generated', error: null })
          .eq('id', cl.id);
        generated++;
      } catch (e) {
        await svc
          .from('campaign_leads')
          .update({ status: 'failed', error: e instanceof Error ? e.message : 'generation failed' })
          .eq('id', cl.id);
      }
    }

    log.info('campaign', 'generated', { campaignId: campaign.id, generated });
    return json({ ok: true, generated });
  } catch (err) {
    return errorResponse(err);
  }
}
