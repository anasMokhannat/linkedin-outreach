import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/messages — every generated message across all leads (drafts + sent),
 * hydrated with lead name/title/company, most recent first. Account-scoped.
 */
export async function GET() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data: msgs, error } = await svc
      .from('messages')
      .select('id, lead_id, body, status, model, edited_by_user, created_at, sent_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);

    const leadIds = Array.from(new Set((msgs ?? []).map((m) => m.lead_id).filter(Boolean)));
    const byId = new Map<string, { first_name: string | null; last_name: string | null; current_title: string | null; current_company: string | null }>();
    if (leadIds.length > 0) {
      const { data: leads } = await svc
        .from('leads')
        .select('id, first_name, last_name, current_title, current_company')
        .eq('account_id', accountId)
        .in('id', leadIds);
      (leads ?? []).forEach((l) => byId.set(l.id, l));
    }

    const messages = (msgs ?? []).map((m) => {
      const l = byId.get(m.lead_id);
      return {
        id: m.id,
        leadId: m.lead_id,
        name: l ? [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead' : 'Lead',
        subtitle: l ? [l.current_title, l.current_company].filter(Boolean).join(' · ') || undefined : undefined,
        body: m.body as string,
        status: m.status as string,
        model: (m.model as string | null) ?? null,
        editedByUser: !!m.edited_by_user,
        createdAt: m.created_at as string,
        sentAt: (m.sent_at as string | null) ?? null,
      };
    });

    return json({ messages });
  } catch (err) {
    return errorResponse(err);
  }
}
