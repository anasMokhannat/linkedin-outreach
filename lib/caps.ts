import 'server-only';

/**
 * Daily-cap + ramp-up engine (spec §0, §9). All limits are enforced SERVER-SIDE.
 *
 * Ramp curve: a freshly connected account starts conservative and grows with
 * account age (days since first validated). Defaults: 15/day → ~35/day.
 * TODO(confirm): exact ramp curve with product owner (open item §14.1).
 */

export interface CapConfig {
  startCap: number; // day 0 cap
  maxCap: number; // ceiling after ramp
  rampPerWeek: number; // cap increase per full week of account age
}

export const DEFAULT_CAP_CONFIG: CapConfig = {
  startCap: 15,
  maxCap: 35,
  rampPerWeek: 5,
};

/** Compute today's DM cap given account age in days and per-user config. */
export function dailyCap(accountAgeDays: number, cfg: CapConfig = DEFAULT_CAP_CONFIG): number {
  const weeks = Math.max(0, Math.floor(accountAgeDays / 7));
  const ramped = cfg.startCap + weeks * cfg.rampPerWeek;
  return Math.min(cfg.maxCap, Math.max(cfg.startCap, ramped));
}

export interface CapStatus {
  cap: number;
  sent: number;
  remaining: number;
  reached: boolean;
}

export function capStatus(
  accountAgeDays: number,
  sentToday: number,
  cfg?: CapConfig
): CapStatus {
  const cap = dailyCap(accountAgeDays, cfg);
  const remaining = Math.max(0, cap - sentToday);
  return { cap, sent: sentToday, remaining, reached: remaining <= 0 };
}

export interface WorkingHours {
  timezone: string; // IANA tz
  startHour: number; // 0-23, local
  endHour: number; // 0-23, local, exclusive
}

export const DEFAULT_WORKING_HOURS: Omit<WorkingHours, 'timezone'> = {
  startHour: 9,
  endHour: 18,
};

/** Current hour (0-23) in a given IANA timezone, using Intl (no extra deps). */
export function hourInTimezone(date: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '0';
  // Intl may render midnight as "24"; normalize.
  const h = parseInt(hour, 10) % 24;
  return Number.isNaN(h) ? 0 : h;
}

export function isWithinWorkingHours(now: Date, wh: WorkingHours): boolean {
  const h = hourInTimezone(now, wh.timezone);
  return h >= wh.startHour && h < wh.endHour;
}

/**
 * Schedule a send: now + jitter (2–8 min by default), shifted into the next
 * working-hours window if currently outside it. Deterministic randomness is not
 * required here; we use a seeded-ish jitter from the message id to avoid Date.now
 * coupling in tests, but Math.random is acceptable at runtime.
 */
export function scheduleSend(
  now: Date,
  wh: WorkingHours,
  jitterMinMin = 2,
  jitterMaxMin = 8
): Date {
  const jitterMin = jitterMinMin + Math.random() * (jitterMaxMin - jitterMinMin);
  let scheduled = new Date(now.getTime() + jitterMin * 60_000);

  if (!isWithinWorkingHours(scheduled, wh)) {
    scheduled = nextWorkingWindowStart(scheduled, wh);
  }
  return scheduled;
}

/** Returns the next instant at the start of the working-hours window. */
export function nextWorkingWindowStart(from: Date, wh: WorkingHours): Date {
  // Advance hour-by-hour until we land inside the window. Bounded to 48 hops.
  const cursor = new Date(from.getTime());
  for (let i = 0; i < 48; i++) {
    const h = hourInTimezone(cursor, wh.timezone);
    if (h >= wh.startHour && h < wh.endHour) {
      // Align to the top of this hour for predictability.
      cursor.setMinutes(0, 0, 0);
      return cursor;
    }
    cursor.setTime(cursor.getTime() + 60 * 60_000);
  }
  return cursor;
}
