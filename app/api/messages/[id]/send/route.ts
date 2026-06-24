import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import {
  capStatus,
  scheduleSend,
  DEFAULT_CAP_CONFIG,
  DEFAULT_WORKING_HOURS,
  type WorkingHours,
} from '@/lib/caps';

export const runtime = 'nodejs';

/**
 * POST /api/messages/:id/send — Gate 3 (Send). One message at a time; no bulk.
 *
 * Cap is enforced HERE, at send time, so the queue never exceeds the daily cap
 * (spec §9): effective usage = already-sent today + still-active queue items.
 * If the cap is reached we BLOCK with 429 and queue nothing.
 *
 * On success: message → 'queued' and a single send_queue row is created with a
 * jittered scheduled_for inside the user's working hours. Delivery itself is
 * performed later by the cron job.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const id = params.id;
    const supabase = createSupabaseServerClient();

    const { data: message } = await supabase
      .from('messages')
      .select('id, status')
      .eq('id', id)
      .maybeSingle();
    if (!message) throw new HttpError(404, 'Message not found.');
    if (message.status !== 'approved') {
      throw new HttpError(409, 'Only an approved message can be sent.');
    }

    const { data: account } = await supabase
      .from('linkedin_accounts')
      .select('status, created_at, li_secret_id')
      .maybeSingle();
    if (!account || !account.li_secret_id) {
      throw new HttpError(400, 'No LinkedIn session connected.');
    }
    if (account.status !== 'connected') {
      throw new HttpError(409, 'Session needs reconnecting before sending.');
    }

    const { data: profile } = await supabase
      .from('users')
      .select('timezone, dms_start_cap, dms_max_cap, ramp_per_week, working_start_hour, working_end_hour')
      .maybeSingle();

    const today = new Date().toISOString().slice(0, 10);
    const { data: usage } = await supabase
      .from('daily_usage')
      .select('dms_sent')
      .eq('day', today)
      .maybeSingle();

    // Count still-active queue items so concurrent sends can't exceed the cap.
    const { count: activeQueue } = await supabase
      .from('send_queue')
      .select('id', { count: 'exact', head: true })
      .in('status', ['pending', 'processing']);

    const ageDays = Math.floor((Date.now() - new Date(account.created_at).getTime()) / 86_400_000);
    const effectiveUsed = (usage?.dms_sent ?? 0) + (activeQueue ?? 0);
    const caps = capStatus(ageDays, effectiveUsed, {
      startCap: profile?.dms_start_cap ?? DEFAULT_CAP_CONFIG.startCap,
      maxCap: profile?.dms_max_cap ?? DEFAULT_CAP_CONFIG.maxCap,
      rampPerWeek: profile?.ramp_per_week ?? DEFAULT_CAP_CONFIG.rampPerWeek,
    });

    if (caps.reached) {
      // Block — do NOT queue past the cap (hard rule).
      throw new HttpError(429, 'Daily limit reached — continue tomorrow.');
    }

    const wh: WorkingHours = {
      timezone: profile?.timezone ?? 'UTC',
      startHour: profile?.working_start_hour ?? DEFAULT_WORKING_HOURS.startHour,
      endHour: profile?.working_end_hour ?? DEFAULT_WORKING_HOURS.endHour,
    };
    const scheduledFor = scheduleSend(new Date(), wh);

    // Transition approved → queued (the ONLY place this happens) + queue row.
    const { error: msgErr } = await supabase
      .from('messages')
      .update({ status: 'queued' })
      .eq('id', id);
    if (msgErr) throw new Error(msgErr.message);

    const { error: qErr } = await supabase.from('send_queue').insert({
      user_id: userId,
      message_id: id,
      scheduled_for: scheduledFor.toISOString(),
      status: 'pending',
    });
    if (qErr) throw new Error(qErr.message);

    await supabase.from('send_log').insert({
      user_id: userId,
      message_id: id,
      event: 'send_requested',
      detail: { scheduledFor: scheduledFor.toISOString() },
    });

    return json({ ok: true, scheduledFor: scheduledFor.toISOString() });
  } catch (err) {
    return errorResponse(err);
  }
}
