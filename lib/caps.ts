import 'server-only';

/**
 * Flat daily DM cap, enforced server-side at send time. Configured per account
 * via `dms_per_day` (Settings).
 */

export const DEFAULT_DMS_PER_DAY = 25;
export const DEFAULT_LEADS_TO_MESSAGE = 50;

export interface CapStatus {
  cap: number;
  sent: number;
  remaining: number;
  reached: boolean;
}

export function capStatus(sentToday: number, dmsPerDay: number): CapStatus {
  const cap = Math.max(0, dmsPerDay || 0);
  const remaining = Math.max(0, cap - sentToday);
  return { cap, sent: sentToday, remaining, reached: remaining <= 0 };
}
