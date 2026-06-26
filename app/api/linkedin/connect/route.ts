import { type NextRequest, NextResponse } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { unipileConnectWithCookie, unipileDeleteAccount } from '@/lib/unipile';
import { finalizeConnection } from '@/lib/connect';
import { SESSION_COOKIE } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/linkedin/connect  { liAt, proxyCountry? } — cookie connect (fallback).
 * Hands the cookie to Unipile once; we persist only the account_id. Sets session.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { liAt?: unknown; proxyCountry?: unknown };
    const liAt = typeof body.liAt === 'string' ? body.liAt.trim() : '';
    const country =
      typeof body.proxyCountry === 'string' && body.proxyCountry.trim()
        ? body.proxyCountry.trim().toUpperCase().slice(0, 2)
        : null;
    if (liAt.length < 20 || liAt.length > 4000 || /\s/.test(liAt)) {
      throw new HttpError(400, 'That does not look like a valid li_at value.');
    }

    const result = await unipileConnectWithCookie(liAt, country);
    if (result.checkpoint) {
      return json({ status: 'checkpoint', checkpointType: result.checkpoint, accountId: result.accountId });
    }
    return await finalizeConnection(result.accountId, country);
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/linkedin/connect — disconnect: remove the Unipile account + clear session. */
export async function DELETE() {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('unipile_account_id')
      .eq('id', accountId)
      .maybeSingle();

    if (account?.unipile_account_id) {
      try {
        await unipileDeleteAccount(account.unipile_account_id);
      } catch {
        /* best-effort */
      }
    }
    await svc.from('linkedin_accounts').update({ status: 'disconnected' }).eq('id', accountId);

    const res = NextResponse.json({ ok: true, status: 'disconnected' });
    res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
