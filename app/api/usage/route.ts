import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { getUsage, DAILY_MESSAGE_LIMIT, WEEKLY_MESSAGE_LIMIT } from '@/lib/limits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/usage — the account's sending allowance (today + trailing week) plus
 * how many messages are currently queued for auto-send. The UI uses `allowedNow`
 * to decide whether to show "Send" or "Add to queue".
 */
export async function GET() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();

    const [usage, { count }] = await Promise.all([
      getUsage(accountId),
      svc
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('account_id', accountId)
        .eq('status', 'queued'),
    ]);

    return json({
      ...usage,
      dailyLimit: DAILY_MESSAGE_LIMIT,
      weeklyLimit: WEEKLY_MESSAGE_LIMIT,
      queued: count ?? 0,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
