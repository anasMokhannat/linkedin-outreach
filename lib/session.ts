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
// Session lifetime. The expiry is baked into the SIGNED payload (so the server
// actually rejects old/copied tokens) and mirrored on the cookie's max-age (so
// the browser also drops it). Reset on every login/connect.
const SESSION_TTL_MS = 60 * 60 * 24 * 7 * 1000; // 7 days
const MAX_AGE = Math.floor(SESSION_TTL_MS / 1000); // cookie max-age (seconds)

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
  /** Expiry (epoch ms) baked into the signed payload. */
  exp: number;
}

/**
 * Sign a session carrying the user id, (optionally) their LinkedIn account id,
 * and an expiry timestamp. The expiry is part of the signed payload, so it can't
 * be tampered with and is enforced server-side on every read.
 */
export function signUserSession(userId: string, accountId?: string | null): string {
  const exp = Date.now() + SESSION_TTL_MS;
  return signSession(JSON.stringify({ u: userId, a: accountId ?? null, e: exp }));
}

/**
 * Verify + decode a user session cookie. Rejects (returns null) when the HMAC is
 * invalid, the payload is malformed, OR the baked expiry has passed. Legacy
 * cookies with no expiry (the old `{u,a}` payload or a bare user id) are treated
 * as expired — users re-log in once, cleanly.
 */
export function readSession(token: string | undefined | null): SessionData | null {
  const value = verifySession(token);
  if (value == null) return null;
  if (!value.startsWith('{')) return null; // legacy bare-uid token → expired
  try {
    const o = JSON.parse(value) as { u?: unknown; a?: unknown; e?: unknown };
    if (typeof o.u !== 'string' || !o.u) return null;
    if (typeof o.e !== 'number' || Date.now() > o.e) return null; // missing/expired
    return { userId: o.u, accountId: typeof o.a === 'string' && o.a ? o.a : null, exp: o.e };
  } catch {
    return null;
  }
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
