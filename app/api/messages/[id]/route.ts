import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { MESSAGE_HARD_CAP } from '@/lib/openrouter';
import type { MessageStatus } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * PATCH /api/messages/:id  { action: 'edit'|'approve'|'reject', body? } — Gate 2.
 *
 * Enforces the message state machine. Crucially, NOTHING here queues a send:
 * approval only moves draft → approved. The approved → queued transition lives
 * solely in the explicit per-message Send route (Gate 3).
 *
 * - edit:    body update; resets to 'draft' and requires re-approval; marks
 *            edited_by_user. Allowed from draft/approved only.
 * - approve: draft → approved (sets approved_at).
 * - reject:  draft/approved → rejected.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireUserId();
    const id = params.id;
    const body = (await req.json().catch(() => ({}))) as { action?: string; body?: string };

    const supabase = createSupabaseServerClient();
    const { data: msg } = await supabase
      .from('messages')
      .select('id, status')
      .eq('id', id)
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
        update.status = 'draft'; // editing requires re-approval
        update.approved_at = null;
        break;
      }
      case 'approve': {
        if (status !== 'draft') {
          throw new HttpError(409, `Only drafts can be approved (was "${status}").`);
        }
        update.status = 'approved';
        update.approved_at = new Date().toISOString();
        break;
      }
      case 'reject': {
        if (!['draft', 'approved'].includes(status)) {
          throw new HttpError(409, `Cannot reject a message in status "${status}".`);
        }
        update.status = 'rejected';
        break;
      }
      default:
        throw new HttpError(400, 'Unknown action.');
    }

    const { data: updated, error } = await supabase
      .from('messages')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw new Error(error.message);

    return json({ ok: true, message: updated });
  } catch (err) {
    return errorResponse(err);
  }
}
