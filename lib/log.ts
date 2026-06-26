/**
 * Tiny structured logger for server-side debugging. Writes to the server console
 * (visible in the `npm run dev` terminal / Vercel function logs).
 *
 * REDACTS sensitive values by key name (password, token, cookie, api key, li_at,
 * code, authorization, …) and truncates very long strings, so secrets never land
 * in logs. Never pass a raw cookie/password as a top-level string and expect it
 * to be masked — only object KEYS are matched; values are masked by their key.
 */

const SENSITIVE =
  /(password|token|secret|cookie|authorization|api[-_]?key|li_at|access_token|^code$)/i;

function redactValue(v: unknown): unknown {
  if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + '…';
  return v;
}

function redact(obj: unknown): unknown {
  if (obj == null || typeof obj !== 'object') return redactValue(obj);
  if (Array.isArray(obj)) return obj.map(redact);
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(obj as Record<string, unknown>)) {
    if (SENSITIVE.test(k)) out[k] = '***';
    else if (val && typeof val === 'object') out[k] = redact(val);
    else out[k] = redactValue(val);
  }
  return out;
}

function fmt(data: unknown): string {
  if (data === undefined) return '';
  try {
    return ' ' + JSON.stringify(redact(data));
  } catch {
    return '';
  }
}

export const log = {
  info: (scope: string, msg: string, data?: unknown) =>
    console.log(`[${scope}] ${msg}${fmt(data)}`),
  warn: (scope: string, msg: string, data?: unknown) =>
    console.warn(`[${scope}] ${msg}${fmt(data)}`),
  error: (scope: string, msg: string, data?: unknown) =>
    console.error(`[${scope}] ${msg}${fmt(data)}`),
};
