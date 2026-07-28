import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/inbox — the leads you're conversing with: anyone you've messaged
 * directly (has a message) or have a chat thread with. Ordered by most recent
 * message. Account-scoped.
 */
export async function GET() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    // Most-recent-first message activity → lead ordering. Only sent messages
    // count as a conversation — a generated-but-unsent draft must NOT surface a
    // lead in the inbox.
    const { data: msgs } = await svc
      .from('messages')
      .select('lead_id, created_at')
      .eq('account_id', accountId)
      .eq('status', 'sent')
      .order('created_at', { ascending: false });

    const orderedIds: string[] = [];
    const seen = new Set<string>();
    for (const m of msgs ?? []) {
      if (m.lead_id && !seen.has(m.lead_id)) { seen.add(m.lead_id); orderedIds.push(m.lead_id); }
    }

    // Also include leads with an existing chat thread but no recorded message.
    const { data: chatLeads } = await svc
      .from('leads')
      .select('id')
      .eq('account_id', accountId)
      .not('provider_chat_id', 'is', null);
    for (const l of chatLeads ?? []) {
      if (!seen.has(l.id)) { seen.add(l.id); orderedIds.push(l.id); }
    }

    if (orderedIds.length === 0) return json({ leads: [] });

    const { data: leads } = await svc
      .from('leads')
      .select('id, first_name, last_name, current_title, current_company')
      .eq('account_id', accountId)
      .in('id', orderedIds);
    const byId = new Map((leads ?? []).map((l) => [l.id, l]));

    const ordered = orderedIds
      .map((id) => byId.get(id))
      .filter((l): l is NonNullable<typeof l> => !!l)
      .map((l) => ({
        leadId: l.id,
        name: [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead',
        subtitle: [l.current_title, l.current_company].filter(Boolean).join(' · ') || undefined,
      }));

    return json({ leads: ordered });
  } catch (err) {
    return errorResponse(err);
  }
}
