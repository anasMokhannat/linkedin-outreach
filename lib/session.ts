import 'server-only';
import crypto from 'node:crypto';
import { serverEnv } from './env';

/**
 * Lightweight session: identity is the connected LinkedIn (Unipile) account.
 * We store the account row id in a signed, httpOnly cookie. There is no separate
 * user auth — connecting via Unipile is what creates the session.
 *
 * Token format: base64url(accountId).base64url(HMAC-SHA256(accountId)).
 * The HMAC key is the Supabase service-role key (a server-only secret), so the
 * cookie can't be forged without it.
 */

export const SESSION_COOKIE = 'fl_session';
/** App-user session cookie (email/password identity), independent of LinkedIn. */
export const USER_COOKIE = 'fl_user';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hmac(value: string): string {
  return b64url(crypto.createHmac('sha256', serverEnv.supabaseServiceRoleKey()).update(value).digest());
}

export function signSession(accountId: string): string {
  return `${b64url(Buffer.from(accountId))}.${hmac(accountId)}`;
}

export function verifySession(token: string | undefined | null): string | null {
  if (!token) return null;
  const [idPart, sig] = token.split('.');
  if (!idPart || !sig) return null;
  let accountId: string;
  try {
    accountId = Buffer.from(idPart.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  } catch {
    return null;
  }
  const expected = hmac(accountId);
  // Constant-time compare.
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return accountId;
}

/**
 * App-user session payload. We bake the LinkedIn account id into the (signed)
 * cookie so account-scoped requests don't need a DB lookup to resolve it.
 */
export interface SessionData {
  userId: string;
  accountId: string | null;
}

/** Sign a session carrying the user id and (optionally) their LinkedIn account id. */
export function signUserSession(userId: string, accountId?: string | null): string {
  return signSession(JSON.stringify({ u: userId, a: accountId ?? null }));
}

/**
 * Verify + decode a user session cookie. Handles both the new `{u,a}` payload and
 * legacy cookies that stored only the bare user id (accountId then resolves to
 * null, so callers fall back to a DB lookup once).
 */
export function readSession(token: string | undefined | null): SessionData | null {
  const value = verifySession(token);
  if (value == null) return null;
  if (value.startsWith('{')) {
    try {
      const o = JSON.parse(value) as { u?: unknown; a?: unknown };
      if (typeof o.u !== 'string' || !o.u) return null;
      return { userId: o.u, accountId: typeof o.a === 'string' && o.a ? o.a : null };
    } catch {
      return null;
    }
  }
  // Legacy token: the signed value is the bare user id.
  return { userId: value, accountId: null };
}

/** Non-guessable token placed in the Unipile webhook URL and verified on receipt. */
export function webhookToken(): string {
  return hmac('unipile-messages-webhook').slice(0, 24);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE,
  };
}
