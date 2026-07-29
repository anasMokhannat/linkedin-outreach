import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * PATCH /api/messages/:id  { body } — manually edit a generated (draft) message.
 * Only drafts are editable; a sent message can't be changed after the fact.
 * Account-scoped.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const b = (await req.json().catch(() => ({}))) as { body?: unknown };
    const body = typeof b.body === 'string' ? b.body.trim() : '';
    if (!body) throw new HttpError(400, 'Message body is required.');

    const svc = createSupabaseServiceClient();
    const { data: updated, error } = await svc
      .from('messages')
      .update({ body, edited_by_user: true })
      .eq('id', params.id)
      .eq('account_id', accountId)
      .eq('status', 'draft')
      .select('id')
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!updated) throw new HttpError(404, 'Draft not found (already sent messages can’t be edited).');

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/messages/:id — discard a draft message. Account-scoped. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const { error } = await svc
      .from('messages')
      .delete()
      .eq('id', params.id)
      .eq('account_id', accountId)
      .eq('status', 'draft');
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
