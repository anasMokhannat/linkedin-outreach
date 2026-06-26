import 'server-only';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, verifySession } from './session';

/**
 * Identity = the connected LinkedIn account. The signed session cookie holds the
 * account row id (linkedin_accounts.id). These helpers verify it server-side.
 */

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/** Returns the authenticated account id, or null when there is no valid session. */
export async function getAccountId(): Promise<string | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySession(token);
}

/** Throws 401 when unauthenticated; otherwise returns the account id. */
export async function requireAccountId(): Promise<string> {
  const accountId = await getAccountId();
  if (!accountId) throw new HttpError(401, 'Not connected');
  return accountId;
}
