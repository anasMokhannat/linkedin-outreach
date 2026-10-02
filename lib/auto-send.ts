import 'server-only';

/**
 * Auto-send pacing policy (server-only). The scheduler (/api/cron/auto-send)
 * drains queued messages one at a time, only inside business hours, with a
 * randomized gap between sends so the timing never looks like clockwork.
 *
 * These are deliberately conservative, LinkedIn-safe defaults. Change the window
 * / timezone here (single source of truth) — they are NOT user-configurable yet.
 */

// Business-hours window the scheduler is allowed to send in.
export const AUTO_SEND_TZ = 'Europe/Paris';
export const AUTO_SEND_START_HOUR = 9; // inclusive, local to AUTO_SEND_TZ
export const AUTO_SEND_END_HOUR = 18; // exclusive (last send before 18:00)
export const AUTO_SEND_DAYS = [1, 2, 3, 4, 5]; // Mon–Fri (0=Sun … 6=Sat)

// Randomized gap between two auto-sends for the same account.
export const AUTO_SEND_GAP_MIN_MS = 8 * 60_000; // 8 min
export const AUTO_SEND_GAP_MAX_MS = 40 * 60_000; // 40 min

// How long a message may sit in 'sending' before it's considered stuck (a tick
// that crashed/timed out mid-send) and requeued. Must exceed the function's max
// runtime so we never requeue a send that's still legitimately in flight.
export const SENDING_STALE_MS = 15 * 60_000; // 15 min

/** A random gap (ms) to wait before the next auto-send for an account. */
export function randomGapMs(): number {
  return Math.floor(AUTO_SEND_GAP_MIN_MS + Math.random() * (AUTO_SEND_GAP_MAX_MS - AUTO_SEND_GAP_MIN_MS));
}

/**
 * Is `now` inside the business-hours window, evaluated in AUTO_SEND_TZ?
 * Uses Intl so it is correct regardless of the server's own timezone (the cron
 * fires in UTC).
 */
export function isWithinBusinessHours(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: AUTO_SEND_TZ,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(now);

  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hourStr = parts.find((p) => p.type === 'hour')?.value ?? '0';
  // Intl can emit "24" for midnight under hour12:false — normalize to 0.
  const hour = Number(hourStr) % 24;

  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[weekday];

  if (day === undefined || !AUTO_SEND_DAYS.includes(day)) return false;
  return hour >= AUTO_SEND_START_HOUR && hour < AUTO_SEND_END_HOUR;
}
