import 'server-only';
import { createSupabaseServiceClient } from './supabase-server';
import { getUsage } from './limits';
import { unipileSendNewMessage, isUnipileAuthError } from './unipile';
import { log } from './log';

/**
 * Send a batch of approved campaign messages for one account, up to the
 * remaining daily/weekly allowance. Shared by the daily cron (all active
 * campaigns) and the manual "Send now" action (optionally a single campaign).
 *
 * Only sends messages whose campaign is `active` and whose campaign_lead is
 * `approved`. Marks each sent, stores the chat id, increments usage, and marks
 * a campaign `done` once it has no remaining open leads.
 */
export async function sendCampaignBatch(
  accountId: string,
  campaignId?: string,
  maxBatch?: number
): Promise<{ sent: number; reason?: string }> {
  const svc = createSupabaseServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: account } = await svc
    .from('linkedin_accounts')
    .select('status, unipile_account_id')
    .eq('id', accountId)
    .maybeSingle();
  if (!account?.unipile_account_id || account.status !== 'connected') {
    return { sent: 0, reason: 'not_connected' };
  }

  const usage = await getUsage(accountId);
  // Cap how many we send in one (interactive) invocation to avoid long requests;
  // the rest go out via the daily cron up to the full allowance.
  let budget = maxBatch != null ? Math.min(usage.allowedNow, maxBatch) : usage.allowedNow;
  if (budget <= 0) return { sent: 0, reason: usage.allowedNow <= 0 ? 'limit_reached' : 'batch_done' };

  let q = svc
    .from('campaign_leads')
    .select('id, lead_id, message_id, campaign_id, campaigns!inner(status), leads(provider_member_id), messages(body)')
    .eq('account_id', accountId)
    .eq('status', 'approved')
    .limit(budget);
  if (campaignId) q = q.eq('campaign_id', campaignId);
  const { data: queue } = await q;

  let sent = 0;
  for (const item of queue ?? []) {
    if (budget <= 0) break;
    if ((item.campaigns as { status?: string } | null)?.status !== 'active') continue;

    const recipientId = (item.leads as { provider_member_id?: string } | null)?.provider_member_id;
    const bodyText = (item.messages as { body?: string } | null)?.body;
    if (!recipientId || !bodyText) {
      await svc.from('campaign_leads').update({ status: 'failed', error: 'missing recipient/message' }).eq('id', item.id);
      continue;
    }

    try {
      const r = await unipileSendNewMessage(account.unipile_account_id, recipientId, bodyText);
      if (r.chatId) await svc.from('leads').update({ provider_chat_id: r.chatId }).eq('id', item.lead_id);
      await svc.from('campaign_leads').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', item.id);
      if (item.message_id) {
        await svc.from('messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', item.message_id);
      }
      await svc.rpc('app_increment_daily_usage', { p_account_id: accountId, p_day: today });
      await svc.from('send_log').insert({ account_id: accountId, message_id: item.message_id, event: 'dm_sent', detail: { campaignId: item.campaign_id } });
      budget--;
      sent++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'send failed';
      if (isUnipileAuthError(msg)) {
        await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('id', accountId);
        await svc.from('campaigns').update({ status: 'paused' }).eq('account_id', accountId).eq('status', 'active');
        break;
      }
      await svc.from('campaign_leads').update({ status: 'failed', error: msg }).eq('id', item.id);
    }
  }

  // Mark active campaigns done when they have no remaining open leads.
  const { data: remaining } = await svc
    .from('campaign_leads')
    .select('campaign_id, status')
    .eq('account_id', accountId);
  const open = new Set<string>();
  (remaining ?? []).forEach((r) => {
    if (['pending', 'generated', 'approved'].includes(r.status)) open.add(r.campaign_id);
  });
  const { data: activeCampaigns } = await svc
    .from('campaigns')
    .select('id')
    .eq('account_id', accountId)
    .eq('status', 'active');
  for (const c of activeCampaigns ?? []) {
    if (!open.has(c.id)) await svc.from('campaigns').update({ status: 'done' }).eq('id', c.id);
  }

  log.info('campaign-sender', 'batch', { accountId, campaignId, sent });
  return { sent };
}
