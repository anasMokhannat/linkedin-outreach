import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
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
    // Generated messages for this lead (drafts + sent), newest first.
    const { data: messages } = await svc
      .from('messages')
      .select('id, body, status, model, created_at, sent_at')
      .eq('account_id', accountId)
      .eq('lead_id', params.id)
      .order('created_at', { ascending: false });
    return json({ lead, enrichment: enrichment ?? null, messages: messages ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH /api/leads/:id  { known } — update the "already know this lead" flag. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const body = (await req.json().catch(() => ({}))) as { known?: unknown };
    if (typeof body.known !== 'boolean') throw new HttpError(400, 'Nothing to update.');
    const svc = createSupabaseServiceClient();
    const { error } = await svc
      .from('leads')
      .update({ known: body.known })
      .eq('id', params.id)
      .eq('account_id', accountId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/leads/:id — remove a lead (account-scoped).
 * `messages` and `lead_enrichment` cascade on the FK, but `notifications`
 * reference the lead with ON DELETE SET NULL, so a generated/sent notification
 * would otherwise linger in the activity feed after the lead is gone. Delete
 * those explicitly so nothing about the lead stays visible.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    await svc
      .from('notifications')
      .delete()
      .eq('account_id', accountId)
      .eq('lead_id', params.id);
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
