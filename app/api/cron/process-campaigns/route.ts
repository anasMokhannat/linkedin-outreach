import { type NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { sendCampaignBatch } from '@/lib/campaign-sender';
import { log } from '@/lib/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * GET /api/cron/process-campaigns — daily throttled campaign sender. Sends each
 * account's approved campaign messages up to the app-defined daily/weekly limit.
 */
export async function GET(_req: NextRequest) {
  const svc = createSupabaseServiceClient();
  const { data: active } = await svc.from('campaigns').select('account_id').eq('status', 'active');
  const accountIds = Array.from(new Set((active ?? []).map((c) => c.account_id)));

  let dispatched = 0;
  for (const accountId of accountIds) {
    const { sent } = await sendCampaignBatch(accountId);
    dispatched += sent;
  }

  log.info('campaign-cron', 'done', { dispatched, accounts: accountIds.length });
  return json({ ok: true, dispatched });
}
