import 'server-only';
import { cookies } from 'next/headers';
import { USER_COOKIE, verifySession } from './session';
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

/** The app-user id from the session cookie, or null when logged out. */
export async function getUserId(): Promise<string | null> {
  const token = cookies().get(USER_COOKIE)?.value;
  return verifySession(token);
}

/** Throws 401 when not logged in; otherwise returns the app-user id. */
export async function requireUserId(): Promise<string> {
  const userId = await getUserId();
  if (!userId) throw new HttpError(401, 'Not signed in');
  return userId;
}

/**
 * The connected LinkedIn account id for the current user, or null when the user
 * is logged out OR hasn't connected a LinkedIn account yet.
 */
export async function getAccountId(): Promise<string | null> {
  const userId = await getUserId();
  if (!userId) return null;
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from('linkedin_accounts')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  return data?.id ?? null;
}

/**
 * Throws 401 when logged out, 409 when logged in but no LinkedIn is connected.
 * Otherwise returns the account id.
 */
export async function requireAccountId(): Promise<string> {
  const userId = await requireUserId();
  const svc = createSupabaseServiceClient();
  const { data } = await svc
    .from('linkedin_accounts')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!data?.id) throw new HttpError(409, 'No LinkedIn account connected.');
  return data.id;
}
