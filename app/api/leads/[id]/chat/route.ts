import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { getUsage } from '@/lib/limits';
import { unipileSendNewMessage, isUnipileAuthError } from '@/lib/unipile';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

/**
 * POST /api/leads/:id/chat  { text } — send a manual chat message to a lead.
 * Counts toward and is blocked by the app-defined daily/weekly limits.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const { text } = (await req.json().catch(() => ({}))) as { text?: string };
    const body = (text ?? '').trim();
    if (!body) throw new HttpError(400, 'Empty message.');

    const svc = createSupabaseServiceClient();
    const { data: lead } = await svc
      .from('leads')
      .select('id, provider_member_id, provider_chat_id')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!lead) throw new HttpError(404, 'Lead not found.');

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('status, unipile_account_id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.unipile_account_id) throw new HttpError(400, 'No LinkedIn account connected.');
    if (account.status !== 'connected') throw new HttpError(409, 'Session needs reconnecting.');

    const usage = await getUsage(accountId);
    if (usage.allowedNow <= 0) throw new HttpError(429, 'Sending limit reached — continue later.');

    const today = new Date().toISOString().slice(0, 10);
    if (!lead.provider_member_id) throw new HttpError(422, 'Lead has no messaging id — re-sync connections.');

    try {
      // Send via the member id — Unipile targets the existing 1:1 chat (or creates
      // it) and returns the current chat id, which avoids stale-id issues.
      const r = await unipileSendNewMessage(account.unipile_account_id, lead.provider_member_id, body);
      if (r.chatId) await svc.from('leads').update({ provider_chat_id: r.chatId }).eq('id', lead.id);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'send failed';
      if (isUnipileAuthError(m)) {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('id', accountId);
        throw new HttpError(409, 'LinkedIn session needs reconnecting.');
      }
      throw err instanceof HttpError ? err : new HttpError(502, 'Failed to send.');
    }

    // Record as a sent message + count usage.
    await svc.from('messages').insert({
      account_id: accountId,
      lead_id: lead.id,
      body,
      status: 'sent',
      sent_at: new Date().toISOString(),
      edited_by_user: true,
    });
    await svc.rpc('app_increment_daily_usage', { p_account_id: accountId, p_day: today });
    await svc.from('send_log').insert({ account_id: accountId, event: 'dm_sent', detail: { via: 'chat' } });
    log.info('chat', 'sent', { accountId, leadId: lead.id });

    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
