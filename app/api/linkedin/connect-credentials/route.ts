import { type NextRequest } from 'next/server';
import { HttpError, requireUserId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { unipileConnectWithCredentials } from '@/lib/unipile';
import { finalizeConnection } from '@/lib/connect';
import { log } from '@/lib/log';

export const runtime = 'nodejs';

/**
 * POST /api/linkedin/connect-credentials  { username, password, country? }
 *
 * The app's "login": connect a LinkedIn account via Unipile native auth (no
 * Unipile UI). The password passes through the server to Unipile once and is
 * never stored or logged. On success a session cookie is set (identity = account).
 *
 * - 200 { status: 'checkpoint', checkpointType, accountId } → needs a 2FA/OTP code.
 * - 200 { status: 'connected' | 'connecting' } (+ session cookie) → done.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = (await req.json().catch(() => ({}))) as {
      username?: unknown;
      password?: unknown;
      country?: unknown;
    };
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const country =
      typeof body.country === 'string' && body.country.trim()
        ? body.country.trim().toUpperCase().slice(0, 2)
        : null;
    if (!username || !password) throw new HttpError(400, 'Email and password are required.');

    log.info('connect', 'credentials attempt', { hasCountry: !!country });
    const result = await unipileConnectWithCredentials(username, password, country);

    if (result.checkpoint) {
      return json({ status: 'checkpoint', checkpointType: result.checkpoint, accountId: result.accountId });
    }
    return await finalizeConnection(result.accountId, country, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
