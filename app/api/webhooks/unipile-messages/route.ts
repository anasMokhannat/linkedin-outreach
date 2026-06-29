import { type NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { webhookToken } from '@/lib/session';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/unipile-messages?s=<token> — Unipile `message_received`.
 *
 * For an INCOMING message (a lead's reply, not one we sent) we create a
 * notification and ensure the lead's chat id is stored. Verified by the token in
 * the URL (set when the webhook was registered). Always returns 200 so Unipile
 * doesn't retry on our internal hiccups.
 */
export async function POST(req: NextRequest) {
  if (new URL(req.url).searchParams.get('s') !== webhookToken()) {
    return json({ error: 'unauthorized' }, 401);
  }

  let d: Record<string, any>;
  try {
    d = (await req.json()) as Record<string, any>;
  } catch {
    return json({ ok: true });
  }

  try {
    const accountId: string | undefined = d.account_id;
    const chatId: string | undefined = d.chat_id ?? d.chat?.id;
    const text: string | undefined =
      typeof d.message === 'string' ? d.message : d.message?.text ?? d.text;
    const sender = d.sender ?? {};
    const senderId: string | undefined =
      sender.attendee_provider_id ?? sender.provider_id ?? d.sender_attendee_id ?? d.sender_id;
    const isSender = d.is_sender === 1 || d.is_sender === true || d.message?.is_sender === 1;

    if (!accountId || isSender) return json({ ok: true, skipped: 'outgoing/missing' });

    const svc = createSupabaseServiceClient();
    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('id, owner_member_id')
      .eq('unipile_account_id', accountId)
      .maybeSingle();
    if (!account) return json({ ok: true, skipped: 'unknown account' });

    // Our own message arriving over the webhook → ignore.
    if (senderId && account.owner_member_id && senderId === account.owner_member_id) {
      return json({ ok: true, skipped: 'self' });
    }

    // Match the lead by their provider id or the chat id.
    let lead: { id: string; provider_chat_id: string | null } | null = null;
    if (senderId) {
      const { data } = await svc
        .from('leads')
        .select('id, provider_chat_id')
        .eq('account_id', account.id)
        .eq('provider_member_id', senderId)
        .maybeSingle();
      lead = data ?? null;
    }
    if (!lead && chatId) {
      const { data } = await svc
        .from('leads')
        .select('id, provider_chat_id')
        .eq('account_id', account.id)
        .eq('provider_chat_id', chatId)
        .maybeSingle();
      lead = data ?? null;
    }
    if (!lead) return json({ ok: true, skipped: 'not a known lead' });

    if (chatId && !lead.provider_chat_id) {
      await svc.from('leads').update({ provider_chat_id: chatId }).eq('id', lead.id);
    }

    await svc.from('notifications').insert({
      account_id: account.id,
      lead_id: lead.id,
      kind: 'reply',
      body: (text ?? '').slice(0, 500),
      chat_id: chatId ?? null,
    });
    log.info('webhook', 'reply notification', { accountId: account.id, leadId: lead.id });
  } catch (err) {
    log.error('webhook', 'message handler error', { message: err instanceof Error ? err.message : 'unknown' });
  }

  return json({ ok: true });
}
