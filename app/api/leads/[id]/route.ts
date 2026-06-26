import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/leads/:id — the lead plus its enrichment (profile detail). */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const { data: lead } = await svc
      .from('leads')
      .select('*')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!lead) return json({ error: 'Lead not found' }, 404);
    const { data: enrichment } = await svc
      .from('lead_enrichment')
      .select('summary, experiences, education, skills, company, recent_posts')
      .eq('lead_id', params.id)
      .maybeSingle();
    return json({ lead, enrichment: enrichment ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/leads/:id — remove a lead (account-scoped; cascades enrichment + messages). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const { error } = await svc
      .from('leads')
      .delete()
      .eq('id', params.id)
      .eq('account_id', accountId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
