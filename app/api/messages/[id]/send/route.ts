import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { getUsage } from '@/lib/limits';
import { unipileSendNewMessage, isUnipileAuthError } from '@/lib/unipile';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

/**
 * POST /api/messages/:id/send — Gate 3. Sends the DM immediately & synchronously
 * via Unipile (no queue/cron). Daily cap enforced server-side; 429 when reached.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data: message } = await svc
      .from('messages')
      .select('id, status, body, lead_id, leads(provider_member_id)')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!message) throw new HttpError(404, 'Message not found.');
    if (message.status !== 'approved') throw new HttpError(409, 'Only an approved message can be sent.');

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('status, unipile_account_id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.unipile_account_id) throw new HttpError(400, 'No LinkedIn account connected.');
    if (account.status !== 'connected') throw new HttpError(409, 'Session needs reconnecting before sending.');

    const recipientId = (message.leads as { provider_member_id?: string } | null)?.provider_member_id;
    if (!recipientId) throw new HttpError(422, 'This lead has no messaging id — re-sync your connections.');

    // App-defined daily + weekly limits (not user-configurable).
    const today = new Date().toISOString().slice(0, 10);
    const usage = await getUsage(accountId);
    if (usage.allowedNow <= 0) throw new HttpError(429, 'Sending limit reached — continue later.');

    log.info('send', 'sending', { accountId, messageId: params.id });
    let leadId: string | undefined;
    try {
      const sent = await unipileSendNewMessage(account.unipile_account_id, recipientId, message.body);
      leadId = (message as { lead_id?: string }).lead_id;
      if (sent.chatId && leadId) {
        await svc.from('leads').update({ provider_chat_id: sent.chatId }).eq('id', leadId);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'send failed';
      if (isUnipileAuthError(msg)) {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('id', accountId);
        throw new HttpError(409, 'LinkedIn session needs reconnecting — message not sent.');
      }
      await svc.from('send_log').insert({ account_id: accountId, message_id: params.id, event: 'send_failed', detail: { message: msg } });
      throw new HttpError(502, 'Sending failed — the message is still approved, you can retry.');
    }

    await svc
      .from('messages')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', params.id)
      .eq('account_id', accountId);
    await svc.rpc('app_increment_daily_usage', { p_account_id: accountId, p_day: today });
    await svc.from('send_log').insert({ account_id: accountId, message_id: params.id, event: 'dm_sent', detail: { provider: 'unipile' } });

    log.info('send', 'sent', { accountId, messageId: params.id });
    return json({ ok: true, status: 'sent' });
  } catch (err) {
    return errorResponse(err);
  }
}
