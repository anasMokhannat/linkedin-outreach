import { requireUserId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { capStatus, DEFAULT_CAP_CONFIG } from '@/lib/caps';

export const runtime = 'nodejs';

/**
 * GET /api/messages — list the user's messages with lead context, plus the
 * current daily cap status so the UI can reflect (but never enforce) the limit.
 */
export async function GET() {
  try {
    const userId = await requireUserId();
    const supabase = createSupabaseServerClient();

    const { data: messages, error } = await supabase
      .from('messages')
      .select('*, leads(first_name, last_name, profile_url, current_company)')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw new Error(error.message);

    const [{ data: account }, { data: profile }] = await Promise.all([
      supabase.from('linkedin_accounts').select('created_at, last_validated, status').maybeSingle(),
      supabase.from('users').select('dms_start_cap, dms_max_cap, ramp_per_week').maybeSingle(),
    ]);

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabase
      .from('daily_usage')
      .select('dms_sent')
      .eq('day', today)
      .maybeSingle();

    const ageDays = account?.created_at
      ? Math.floor((Date.now() - new Date(account.created_at).getTime()) / 86_400_000)
      : 0;
    const caps = capStatus(ageDays, usage?.dms_sent ?? 0, {
      startCap: profile?.dms_start_cap ?? DEFAULT_CAP_CONFIG.startCap,
      maxCap: profile?.dms_max_cap ?? DEFAULT_CAP_CONFIG.maxCap,
      rampPerWeek: profile?.ramp_per_week ?? DEFAULT_CAP_CONFIG.rampPerWeek,
    });

    return json({
      messages: messages ?? [],
      caps,
      accountStatus: account?.status ?? null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
