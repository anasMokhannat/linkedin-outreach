import 'server-only';
import { cookies } from 'next/headers';
import { USER_COOKIE, readSession, type SessionData } from './session';
import { createSupabaseServiceClient } from './supabase-server';

/**
 * Two-layer identity:
 *  - App user (email/password) — the signed `fl_user` cookie holds users.id.
 *  - Each user owns (1:1) a connected LinkedIn account (linkedin_accounts.user_id).
 *
 * Data is still keyed by account_id, but access is gated user -> their account.
 * Signing out of the app clears the user cookie only; the LinkedIn connection
 * stays intact on Unipile.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Decode the signed session cookie (user id + baked account id), or null. */
function currentSession(): SessionData | null {
  return readSession(cookies().get(USER_COOKIE)?.value);
}

/** One-time DB lookup for legacy sessions whose cookie predates the baked account id. */
async function accountIdFromDb(userId: string): Promise<string | null> {
  const svc = createSupabaseServiceClient();
  const { data } = await svc.from('linkedin_accounts').select('id').eq('user_id', userId).maybeSingle();
  return data?.id ?? null;
}

/** The app-user id from the session cookie, or null when logged out. */
export async function getUserId(): Promise<string | null> {
  return currentSession()?.userId ?? null;
}

/** Throws 401 when not logged in; otherwise returns the app-user id. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new HttpError(401, 'Not signed in');
  return userId;
}

/**
 * The connected LinkedIn account id for the current user, or null when the user
 * is logged out OR hasn't connected a LinkedIn account yet. Read straight from the
 * signed cookie (no DB); legacy cookies fall back to a one-time lookup.
 */
export async function getAccountId(): Promise<string | null> {
  const s = currentSession();
  if (!s) return null;
  if (s.accountId) return s.accountId;
  return accountIdFromDb(s.userId);
}

/**
 * Throws 401 when logged out, 409 when logged in but no LinkedIn is connected.
 * Otherwise returns the account id — from the signed cookie (no DB) whenever
 * possible, else a one-time DB fallback for legacy sessions.
 */
export async function requireAccountId(): Promise<string> {
  const s = currentSession();
  if (!s) throw new HttpError(401, 'Not signed in');
  if (s.accountId) return s.accountId;
  const accountId = await accountIdFromDb(s.userId);
  if (!accountId) throw new HttpError(409, 'No LinkedIn account connected.');
  return accountId;
}
