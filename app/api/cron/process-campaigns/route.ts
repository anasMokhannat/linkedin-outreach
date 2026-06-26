import { type NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { getUsage } from '@/lib/limits';
import { unipileSendNewMessage, isUnipileAuthError } from '@/lib/unipile';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/process-campaigns — daily throttled campaign sender.
 *
 * For each account with active campaigns, sends up to the remaining daily/weekly
 * allowance (app-defined limits) of approved campaign messages via Unipile, then
 * marks them sent and increments usage. Cap is enforced here, so we never exceed
 * the LinkedIn/Unipile-safe limits regardless of campaign size.
 *
 * No CRON_SECRET gate is needed for correctness (it only sends already-approved,
 * cap-bounded messages), but you can add one if exposing publicly.
 */
export async function GET(_req: NextRequest) {
  const svc = createSupabaseServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  // Accounts that have active campaigns.
  const { data: active } = await svc.from('campaigns').select('account_id').eq('status', 'active');
  const accountIds = Array.from(new Set((active ?? []).map((c) => c.account_id)));

  let dispatched = 0;
  const results: Record<string, number> = {};

  for (const accountId of accountIds) {
    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('status, unipile_account_id')
      .eq('id', accountId)
      .maybeSingle();
    if (!account?.unipile_account_id || account.status !== 'connected') continue;

    const usage = await getUsage(accountId);
    let budget = usage.allowedNow;
    if (budget <= 0) continue;

    // Approved, not-yet-sent campaign leads for this account's active campaigns.
    const { data: queue } = await svc
      .from('campaign_leads')
      .select('id, lead_id, message_id, campaign_id, campaigns!inner(status), leads(provider_member_id), messages(body)')
      .eq('account_id', accountId)
      .eq('status', 'approved')
      .limit(budget);

    for (const item of queue ?? []) {
      if (budget <= 0) break;
      const campaign = item.campaigns as { status?: string } | null;
      if (campaign?.status !== 'active') continue;

      const recipientId = (item.leads as { provider_member_id?: string } | null)?.provider_member_id;
      const bodyText = (item.messages as { body?: string } | null)?.body;
      if (!recipientId || !bodyText) {
        await svc.from('campaign_leads').update({ status: 'failed', error: 'missing recipient/message' }).eq('id', item.id);
        continue;
      }

      try {
        await unipileSendNewMessage(account.unipile_account_id, recipientId, bodyText);
        await svc.from('campaign_leads').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', item.id);
        if (item.message_id) {
          await svc.from('messages').update({ status: 'sent', sent_at: new Date().toISOString() }).eq('id', item.message_id);
        }
        await svc.rpc('app_increment_daily_usage', { p_account_id: accountId, p_day: today });
        await svc.from('send_log').insert({ account_id: accountId, message_id: item.message_id, event: 'dm_sent', detail: { campaignId: item.campaign_id } });
        budget--;
        dispatched++;
        results[accountId] = (results[accountId] ?? 0) + 1;
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

    // Mark campaigns done when every lead is sent/failed/skipped.
    const { data: remaining } = await svc
      .from('campaign_leads')
      .select('campaign_id, status')
      .eq('account_id', accountId);
    const open = new Map<string, boolean>();
    (remaining ?? []).forEach((r) => {
      if (['pending', 'generated', 'approved'].includes(r.status)) open.set(r.campaign_id, true);
    });
    const { data: accCampaigns } = await svc.from('campaigns').select('id').eq('account_id', accountId).eq('status', 'active');
    for (const c of accCampaigns ?? []) {
      if (!open.get(c.id)) await svc.from('campaigns').update({ status: 'done' }).eq('id', c.id);
    }
  }

  log.info('campaign-cron', 'done', { dispatched, accounts: accountIds.length });
  return json({ ok: true, dispatched, results });
}
