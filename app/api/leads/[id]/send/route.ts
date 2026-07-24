import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { getUsage } from '@/lib/limits';
import { unipileSendNewMessage, isUnipileAuthError } from '@/lib/unipile';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

/**
 * POST /api/leads/:id/send  { body }
 * Sends a message to one lead directly (no campaign), enforcing the daily/weekly
 * cap. Records the message as sent, increments usage, stores the chat id.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const accountId = await requireAccountId();
    const b = (await req.json().catch(() => ({}))) as { body?: unknown };
    const text = typeof b.body === 'string' ? b.body.trim() : '';
    if (!text) throw new HttpError(400, 'Message body is required.');

    const svc = createSupabaseServiceClient();

    const usage = await getUsage(accountId);
    if (usage.allowedNow <= 0) throw new HttpError(429, 'Daily/weekly sending limit reached — continue later.');

    const { data: lead } = await svc
      .from('leads')
      .select('id, provider_member_id')
      .eq('id', params.id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!lead) throw new HttpError(404, 'Lead not found.');
    if (!lead.provider_member_id) throw new HttpError(422, 'No LinkedIn recipient id for this lead.');

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('unipile_account_id, status')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.unipile_account_id || account.status !== 'connected') {
      throw new HttpError(409, 'LinkedIn account not connected.');
    }

    try {
      const r = await unipileSendNewMessage(account.unipile_account_id, lead.provider_member_id, text);
      if (r.chatId) await svc.from('leads').update({ provider_chat_id: r.chatId }).eq('id', lead.id);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'send failed';
      if (isUnipileAuthError(msg)) {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('id', accountId);
        throw new HttpError(409, 'LinkedIn session needs reconnecting.');
      }
      throw new HttpError(502, msg);
    }

    // Record the sent message (update the existing draft, or insert a fresh row).
    const now = new Date().toISOString();
    const { data: draft } = await svc
      .from('messages')
      .select('id')
      .eq('account_id', accountId)
      .eq('lead_id', lead.id)
      .eq('status', 'draft')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (draft) {
      await svc.from('messages').update({ body: text, status: 'sent', sent_at: now }).eq('id', draft.id);
    } else {
      await svc.from('messages').insert({ account_id: accountId, lead_id: lead.id, body: text, status: 'sent', sent_at: now });
    }

    const today = now.slice(0, 10);
    await svc.rpc('app_increment_daily_usage', { p_account_id: accountId, p_day: today });
    await svc.from('send_log').insert({ account_id: accountId, event: 'dm_sent', detail: { direct: true, leadId: lead.id } });
    // Activity log entry (read=true — own action, no unread badge).
    await svc.from('notifications').insert({
      account_id: accountId,
      lead_id: lead.id,
      kind: 'sent',
      body: text.slice(0, 140),
      read: true,
    });

    log.info('leads', 'sent', { leadId: lead.id });
    return json({ ok: true, sent: true });
  } catch (err) {
    return errorResponse(err);
  }
}
