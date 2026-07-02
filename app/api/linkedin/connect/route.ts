import { type NextRequest, NextResponse } from 'next/server';
import { requireAccountId, requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { unipileConnectWithCookie, unipileDeleteAccount } from '@/lib/unipile';
import { finalizeConnection } from '@/lib/connect';

export const runtime = 'nodejs';

/**
 * POST /api/linkedin/connect  { liAt, proxyCountry? } — cookie connect (fallback).
 * Hands the cookie to Unipile once; we persist only the account_id. Sets session.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
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
    return await finalizeConnection(result.accountId, country, userId);
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/linkedin/connect — disconnect LinkedIn: remove the Unipile account
 * and detach it from the user. The app session stays intact (user remains
 * signed in); they land back on the connect page.
 */
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
    // Detach from the user so a fresh connect starts clean (and requireAccountId
    // reports "no LinkedIn connected").
    await svc
      .from('linkedin_accounts')
      .update({ status: 'disconnected', user_id: null, unipile_account_id: null })
      .eq('id', accountId);

    return NextResponse.json({ ok: true, status: 'disconnected' });
  } catch (err) {
    return errorResponse(err);
  }
}
