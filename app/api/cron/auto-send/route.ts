import { type NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { serverEnv } from '@/lib/env';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { getUsage } from '@/lib/limits';
import { isWithinBusinessHours, randomGapMs } from '@/lib/auto-send';
import { unipileSendNewMessage, isUnipileAuthError } from '@/lib/unipile';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/auto-send — the scheduler tick (called by an external cron, e.g.
 * cron-job.org, with `Authorization: Bearer <CRON_SECRET>`).
 *
 * Per tick it sends AT MOST ONE queued message per account, and only when:
 *  - it's inside business hours (lib/auto-send),
 *  - the account still has daily/weekly allowance (lib/limits),
 *  - enough randomized time has passed since that account's last auto-send
 *    (next_auto_send_at), which is what spreads the sends out irregularly.
 *
 * Serverless functions can't sleep for long, so pacing comes from cron frequency
 * + the random per-account gap, not from waiting inside this handler.
 */
export async function GET(req: NextRequest) {
  // Auth: constant shared secret. Vercel Cron and cron-job.org both send it as
  // an Authorization bearer header.
  if (req.headers.get('authorization') !== `Bearer ${serverEnv.cronSecret()}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!isWithinBusinessHours()) {
    return json({ ok: true, skipped: 'outside-business-hours', sent: 0 });
  }

  const svc = createSupabaseServiceClient();
  const now = new Date();

  // Accounts that currently have something queued.
  const { data: qrows } = await svc.from('messages').select('account_id').eq('status', 'queued');
  const accountIds = Array.from(new Set((qrows ?? []).map((r) => r.account_id as string)));
  if (accountIds.length === 0) return json({ ok: true, sent: 0, note: 'empty-queue' });

  let sent = 0;
  const results: Array<{ accountId: string; outcome: string }> = [];

  for (const accountId of accountIds) {
    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('unipile_account_id, status, next_auto_send_at')
      .eq('id', accountId)
      .maybeSingle();

    if (!account?.unipile_account_id || account.status !== 'connected') {
      results.push({ accountId, outcome: 'not-connected' });
      continue;
    }
    // Respect the randomized gap since this account's last auto-send.
    if (account.next_auto_send_at && new Date(account.next_auto_send_at) > now) {
      results.push({ accountId, outcome: 'waiting-gap' });
      continue;
    }
    // Respect the daily/weekly caps.
    const usage = await getUsage(accountId);
    if (usage.allowedNow <= 0) {
      results.push({ accountId, outcome: 'cap-reached' });
      continue;
    }

    // Oldest queued message for this account.
    const { data: msg } = await svc
      .from('messages')
      .select('id, lead_id, body')
      .eq('account_id', accountId)
      .eq('status', 'queued')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!msg) {
      results.push({ accountId, outcome: 'none-queued' });
      continue;
    }

    const { data: lead } = await svc
      .from('leads')
      .select('id, provider_member_id')
      .eq('id', msg.lead_id)
      .eq('account_id', accountId)
      .maybeSingle();
    if (!lead?.provider_member_id) {
      // Can't send (lead gone or no recipient id) — mark failed so we don't retry forever.
      await svc.from('messages').update({ status: 'failed' }).eq('id', msg.id);
      results.push({ accountId, outcome: 'lead-unsendable' });
      continue;
    }

    const text = (msg.body as string) ?? '';
    try {
      const r = await unipileSendNewMessage(account.unipile_account_id as string, lead.provider_member_id, text);
      if (r.chatId) await svc.from('leads').update({ provider_chat_id: r.chatId }).eq('id', lead.id);
    } catch (e) {
      const m = e instanceof Error ? e.message : 'send failed';
      if (isUnipileAuthError(m)) {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('id', accountId);
        results.push({ accountId, outcome: 'needs-reauth' });
      } else {
        // Transient — leave it queued and try again next tick, but still honor the gap.
        await svc
          .from('linkedin_accounts')
          .update({ next_auto_send_at: new Date(now.getTime() + randomGapMs()).toISOString() })
          .eq('id', accountId);
        log.warn('cron', 'auto-send failed', { accountId, leadId: lead.id, msg: m });
        results.push({ accountId, outcome: 'send-error' });
      }
      continue;
    }

    // Success — mirror the manual send route's bookkeeping.
    const iso = now.toISOString();
    await svc.from('messages').update({ status: 'sent', body: text, sent_at: iso }).eq('id', msg.id);
    await svc.rpc('app_increment_daily_usage', { p_account_id: accountId, p_day: iso.slice(0, 10) });
    await svc.from('send_log').insert({ account_id: accountId, event: 'dm_sent', detail: { auto: true, leadId: lead.id } });
    await svc.from('notifications').insert({
      account_id: accountId,
      lead_id: lead.id,
      kind: 'sent',
      body: text.slice(0, 140),
      read: true,
    });
    // Push the next allowed send out by a random gap → irregular timing.
    await svc
      .from('linkedin_accounts')
      .update({ next_auto_send_at: new Date(now.getTime() + randomGapMs()).toISOString() })
      .eq('id', accountId);

    sent++;
    results.push({ accountId, outcome: 'sent' });
    log.info('cron', 'auto-sent', { accountId, leadId: lead.id });
  }

  return json({ ok: true, sent, accounts: results });
}
