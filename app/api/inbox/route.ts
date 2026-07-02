import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/inbox — the leads you're conversing with (everyone in a campaign),
 * shaped for the chat sidebar. Account-scoped.
 */
export async function GET() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    // Distinct leads that are part of any campaign (with their campaign ids).
    const { data: cl } = await svc
      .from('campaign_leads')
      .select('lead_id, campaign_id, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    const leadIds = Array.from(new Set((cl ?? []).map((r) => r.lead_id)));
    if (leadIds.length === 0) return json({ leads: [] });

    // Campaign names, then a lead -> campaign name(s) map.
    const { data: campaigns } = await svc
      .from('campaigns')
      .select('id, name')
      .eq('account_id', accountId);
    const campaignName = new Map((campaigns ?? []).map((c) => [c.id, c.name]));

    const leadCampaigns = new Map<string, string[]>();
    for (const r of cl ?? []) {
      const nm = campaignName.get(r.campaign_id);
      if (!nm) continue;
      const list = leadCampaigns.get(r.lead_id) ?? [];
      if (!list.includes(nm)) list.push(nm);
      leadCampaigns.set(r.lead_id, list);
    }

    const { data: leads } = await svc
      .from('leads')
      .select('id, first_name, last_name, current_title, current_company')
      .eq('account_id', accountId)
      .in('id', leadIds);

    const byId = new Map((leads ?? []).map((l) => [l.id, l]));
    // Preserve campaign_leads recency ordering.
    const ordered = leadIds
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => !!l)
      .map((l) => {
        const camps = leadCampaigns.get(l.id) ?? [];
        return {
          leadId: l.id,
          name: [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead',
          subtitle:
            [l.current_title, l.current_company, camps.length ? `◆ ${camps.join(', ')}` : null]
              .filter(Boolean)
              .join(' · ') || undefined,
        };
      });

    return json({ leads: ordered });
  } catch (err) {
    return errorResponse(err);
  }
}
