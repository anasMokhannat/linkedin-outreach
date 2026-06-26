import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { MESSAGE_HARD_CAP } from '@/lib/openrouter';
import type { MessageStatus } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * PATCH /api/messages/:id  { action: 'edit'|'approve'|'reject', body? } — Gate 2.
 * Enforces the state machine; sending never happens here (only on /send).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const body = (await req.json().catch(() => ({}))) as { action?: string; body?: string };

    const svc = createSupabaseServiceClient();
    const { data: msg } = await svc
      .from('messages')
      .select('id, status')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!msg) throw new HttpError(404, 'Message not found.');

    const status = msg.status as MessageStatus;
    const update: Record<string, unknown> = {};

    switch (body.action) {
      case 'edit': {
        if (!['draft', 'approved'].includes(status)) {
          throw new HttpError(409, `Cannot edit a message in status "${status}".`);
        }
        const newBody = (body.body ?? '').trim();
        if (!newBody) throw new HttpError(400, 'Empty message body.');
        if (newBody.length > MESSAGE_HARD_CAP) {
          throw new HttpError(400, `Message exceeds ${MESSAGE_HARD_CAP} characters.`);
        }
        update.body = newBody;
        update.edited_by_user = true;
        update.status = 'draft';
        update.approved_at = null;
        break;
      }
      case 'approve':
        if (status !== 'draft') throw new HttpError(409, `Only drafts can be approved (was "${status}").`);
        update.status = 'approved';
        update.approved_at = new Date().toISOString();
        break;
      case 'reject':
        if (!['draft', 'approved'].includes(status)) {
          throw new HttpError(409, `Cannot reject a message in status "${status}".`);
        }
        update.status = 'rejected';
        break;
      default:
        throw new HttpError(400, 'Unknown action.');
    }

    const { data: updated, error } = await svc
      .from('messages')
      .update(update)
      .eq('id', params.id)
      .eq('account_id', accountId)
      .select('*')
      .single();
    if (error) throw new Error(error.message);
    return json({ ok: true, message: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
