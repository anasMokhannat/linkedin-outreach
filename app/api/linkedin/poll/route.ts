import { type NextRequest } from 'next/server';
import { HttpError } from '@/lib/auth';
import { errorResponse } from '@/lib/http';
import { finalizeConnection } from '@/lib/connect';

export const runtime = 'nodejs';

/**
 * POST /api/linkedin/poll  { accountId, country? }
 *
 * Polls a pending connection (e.g. IN_APP_VALIDATION — the user approves in the
 * LinkedIn mobile app). Returns { status: 'connected' } (+ session cookie) once
 * the account is OK, or { status: 'await_approval' } while still pending. The
 * client calls this on an interval after an in-app checkpoint.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { accountId?: unknown; country?: unknown };
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    const country =
      typeof body.country === 'string' && body.country.trim()
        ? body.country.trim().toUpperCase().slice(0, 2)
        : null;
    if (!accountId) throw new HttpError(400, 'accountId required.');
    return await finalizeConnection(accountId, country);
  } catch (err) {
    return errorResponse(err);
  }
}
