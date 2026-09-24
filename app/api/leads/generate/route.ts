import { type NextRequest } from 'next/server';
import { requireAccountId, requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { generateMessage } from '@/lib/openrouter';
import { selectStrategy, FLUGIA_COMPANY, FLUGIA_GOAL, FLUGIA_VALUE_PROP } from '@/lib/playbook';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BATCH_CAP = 20; // keep the request within serverless time limits

interface EnrichedPost { text?: string }

/**
 * POST /api/leads/generate  { leadIds[] }
 * Generates ONE draft message per lead (playbook-grounded, FLUGIA context),
 * replacing any prior unsent draft. Returns the drafts for preview/edit before
 * sending. Not tied to campaigns.
 */
export async function POST(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const userId = await requireUserId();
    const body = (await req.json().catch(() => ({}))) as { leadIds?: unknown; language?: unknown };
    const leadIds = Array.isArray(body.leadIds) ? (body.leadIds as string[]).filter((x) => typeof x === 'string') : [];
    if (leadIds.length === 0) throw new HttpError(400, 'No leads selected.');

    // Output language: 'auto' (or absent) → the model detects the lead's own
    // profile language; a known code forces that language for every lead.
    const LANGUAGES: Record<string, string> = { en: 'English', fr: 'French', nl: 'Dutch' };
    const langCode = typeof body.language === 'string' ? body.language : 'auto';
    const targetLanguage = LANGUAGES[langCode] ?? null;

    const svc = createSupabaseServiceClient();
    // Sender nature (associate vs partner) → drives how the message refers to FLUGIA.
    const { data: sender } = await svc.from('users').select('writer_role').eq('id', userId).maybeSingle();
    const senderRole = sender?.writer_role === 'associate' ? 'associate' : 'partner';
    const { data: allLeads, error: leadsError } = await svc
      .from('leads')
      .select('id, first_name, last_name, current_title, current_company, industry, company_size, known, recent_posts, enrich_status')
      .eq('account_id', accountId)
      .in('id', leadIds.slice(0, BATCH_CAP));
    if (leadsError) throw new Error(leadsError.message);
    if (!allLeads || allLeads.length === 0) throw new HttpError(400, 'No valid leads.');

    // A known contact can be messaged without enrichment (the message doesn't use
    // their profile). A NEW lead must be fully enriched first (the message grounds
    // on their role/company) — skip the ones that aren't.
    const leads = allLeads.filter((l) => l.known || l.enrich_status === 'full');
    const skipped = allLeads.length - leads.length;
    if (leads.length === 0) {
      throw new HttpError(400, 'These leads must be enriched before generating (only known contacts can skip enrichment).');
    }

    const results: Array<{ leadId: string; body: string }> = [];
    for (const lead of leads) {
      const posts = Array.isArray(lead.recent_posts)
        ? ((lead.recent_posts as EnrichedPost[]).map((p) => p.text).filter(Boolean) as string[])
        : [];

      try {
        const { body: msgBody, model } = await generateMessage({
          firstName: lead.first_name,
          lastName: lead.last_name,
          currentTitle: lead.current_title,
          currentCompany: lead.current_company,
          industry: lead.industry,
          recentPosts: posts.slice(0, 3),
          companyAbout: null,
          senderValueProp: FLUGIA_VALUE_PROP,
          senderGoal: FLUGIA_GOAL,
          senderCompany: FLUGIA_COMPANY,
          knownContact: !!lead.known,
          targetLanguage,
          senderRole,
          strategy: selectStrategy({
            title: lead.current_title,
            industry: lead.industry,
            company: lead.current_company,
            employeeCount: lead.company_size,
          }),
        });

        // Replace any prior unsent draft for this lead.
        await svc.from('messages').delete().eq('account_id', accountId).eq('lead_id', lead.id).eq('status', 'draft');
        await svc.from('messages').insert({
          account_id: accountId,
          lead_id: lead.id,
          body: msgBody,
          model,
          status: 'draft',
        });
        // Activity log entry (read=true — it's the user's own action, no badge).
        await svc.from('notifications').insert({
          account_id: accountId,
          lead_id: lead.id,
          kind: 'generated',
          body: msgBody.slice(0, 140),
          read: true,
        });
        results.push({ leadId: lead.id, body: msgBody });
      } catch (e) {
        log.warn('leads', 'generate failed', { leadId: lead.id, err: e instanceof Error ? e.message : 'unknown' });
        results.push({ leadId: lead.id, body: '' });
      }
    }

    log.info('leads', 'generated', { count: results.filter((r) => r.body).length, skipped });
    return json({ ok: true, drafts: results, skipped });
  } catch (err) {
    return errorResponse(err);
  }
}
