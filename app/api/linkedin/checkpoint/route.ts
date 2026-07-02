import { type NextRequest } from 'next/server';
import { HttpError, requireUserId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { unipileSolveCheckpoint } from '@/lib/unipile';
import { finalizeConnection } from '@/lib/connect';

export const runtime = 'nodejs';

/**
 * POST /api/linkedin/checkpoint  { accountId, code, country? }
 * Solves the 2FA/OTP checkpoint from native connect, then sets the session.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = (await req.json().catch(() => ({}))) as {
      accountId?: unknown;
      code?: unknown;
      country?: unknown;
    };
    const accountId = typeof body.accountId === 'string' ? body.accountId : '';
    const code = typeof body.code === 'string' ? body.code.trim() : '';
    const country =
      typeof body.country === 'string' && body.country.trim()
        ? body.country.trim().toUpperCase().slice(0, 2)
        : null;
    if (!accountId || !code) throw new HttpError(400, 'Account and code are required.');

    const result = await unipileSolveCheckpoint(accountId, code);
    if (result.checkpoint) {
      return json({ status: 'checkpoint', checkpointType: result.checkpoint, accountId: result.accountId });
    }
    return await finalizeConnection(result.accountId, country, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
