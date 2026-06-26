import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { capStatus } from '@/lib/caps';
import { DAILY_MESSAGE_LIMIT } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/account — status, settings, today's usage, and pipeline counts (Overview). */
export async function GET() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('status, display_name, dms_per_day, leads_to_message, last_validated, last_sync_at')
      .eq('id', accountId)
      .maybeSingle();

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await svc
      .from('daily_usage')
      .select('dms_sent')
      .eq('account_id', accountId)
      .eq('day', today)
      .maybeSingle();

    const [{ count: leadCount }, { count: sentCount }, { count: draftCount }] = await Promise.all([
      svc.from('leads').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
      svc.from('messages').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'sent'),
      svc.from('messages').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'draft'),
    ]);

    const caps = capStatus(usage?.dms_sent ?? 0, DAILY_MESSAGE_LIMIT);

    return json({
      account: account ?? null,
      caps,
      counts: { leads: leadCount ?? 0, sent: sentCount ?? 0, drafts: draftCount ?? 0 },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
