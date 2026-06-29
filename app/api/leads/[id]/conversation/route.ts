import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { unipileGetChatMessages, unipileFindChatByAttendee } from '@/lib/unipile';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leads/:id/conversation — the full LinkedIn conversation with a lead.
 *
 * Chat ids are per Unipile account and go stale on reconnect, so we re-resolve
 * the current chat id from the lead's member id (and cache it), then fetch.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data: lead } = await svc
      .from('leads')
      .select('provider_chat_id, provider_member_id')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!lead) throw new HttpError(404, 'Lead not found.');

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('unipile_account_id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.unipile_account_id) return json({ messages: [], hasChat: false });

    const chatId = lead.provider_chat_id as string | null;

    // Fast path: use the cached chat id (one call). Only when it's missing or
    // stale (404 after a reconnect) do we re-resolve via the chat list.
    let messages = chatId ? await unipileGetChatMessages(chatId) : null;

    if (messages === null && lead.provider_member_id) {
      const resolved = await unipileFindChatByAttendee(account.unipile_account_id, lead.provider_member_id);
      if (resolved) {
        if (resolved !== chatId) await svc.from('leads').update({ provider_chat_id: resolved }).eq('id', params.id);
        messages = await unipileGetChatMessages(resolved);
      }
    }

    return json({ messages: messages ?? [], hasChat: messages !== null });
  } catch (err) {
    return errorResponse(err);
  }
}
