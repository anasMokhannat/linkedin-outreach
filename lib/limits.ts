import 'server-only';
import { createSupabaseServiceClient } from './supabase-server';

/**
 * App-defined sending limits — conservative LinkedIn/Unipile-safe caps.
 * NOT user-configurable (deliberately hardcoded here).
 */
export const DAILY_MESSAGE_LIMIT = 25;
export const WEEKLY_MESSAGE_LIMIT = 100;

/** Per-send pacing jitter used by the campaign sender (ms). */
export const SEND_JITTER_MS_MIN = 1500;
export const SEND_JITTER_MS_MAX = 6000;

export interface UsageWindow {
  sentToday: number;
  sentThisWeek: number;
  dailyRemaining: number;
  weeklyRemaining: number;
  /** Max messages allowed to send right now (min of the two windows). */
  allowedNow: number;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Compute today's + trailing-7-day usage for an account and remaining allowances. */
export async function getUsage(accountId: string): Promise<UsageWindow> {
  const svc = createSupabaseServiceClient();
  const today = new Date();
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000); // inclusive 7-day window

  const { data: rows } = await svc
    .from('daily_usage')
    .select('day, dms_sent')
    .eq('account_id', accountId)
    .gte('day', isoDay(weekAgo));

  const todayKey = isoDay(today);
  let sentToday = 0;
  let sentThisWeek = 0;
  for (const r of rows ?? []) {
    sentThisWeek += r.dms_sent ?? 0;
    if (r.day === todayKey) sentToday += r.dms_sent ?? 0;
  }

  const dailyRemaining = Math.max(0, DAILY_MESSAGE_LIMIT - sentToday);
  const weeklyRemaining = Math.max(0, WEEKLY_MESSAGE_LIMIT - sentThisWeek);
  return {
    sentToday,
    sentThisWeek,
    dailyRemaining,
    weeklyRemaining,
    allowedNow: Math.min(dailyRemaining, weeklyRemaining),
  };
}
