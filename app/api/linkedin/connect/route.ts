import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { storeCookie, deleteCookie } from '@/lib/vault';

export const runtime = 'nodejs';

/**
 * POST /api/linkedin/connect  { liAt, proxyCountry? }
 *
 * Stores the LinkedIn `li_at` session cookie. The plaintext cookie is encrypted
 * into Supabase Vault and ONLY its secret id is persisted. The cookie is never
 * returned to the client, never logged, never written to a plain column.
 *
 * Validation: we perform a basic format sanity check synchronously. We do NOT
 * long-poll an Apify run here (hard rule). Functional validation happens on the
 * first connections sync; an auth failure there flips the account to
 * needs_reauth via the webhook.
 *
 * TODO(confirm): if a dedicated "cheap test run" is desired at connect time, run
 * it async and let /api/webhooks/apify set last_validated — do not block here.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = (await req.json().catch(() => ({}))) as {
      liAt?: unknown;
      proxyCountry?: unknown;
    };

    const liAt = typeof body.liAt === 'string' ? body.liAt.trim() : '';
    const proxyCountry =
      typeof body.proxyCountry === 'string' && body.proxyCountry.trim()
        ? body.proxyCountry.trim().toUpperCase().slice(0, 2)
        : null;

    // li_at is an opaque token, typically a long base64-ish string. Reject the
    // obvious junk without ever echoing the value back.
    if (liAt.length < 20 || liAt.length > 4000 || /\s/.test(liAt)) {
      throw new HttpError(400, 'That does not look like a valid li_at value.');
    }

    // Service role so we can touch Vault + the account row regardless of RLS,
    // but we scope every write to this user_id explicitly.
    const svc = createSupabaseServiceClient();

    // Replace any existing secret for this user.
    const { data: existing } = await svc
      .from('linkedin_accounts')
      .select('id, li_secret_id')
      .eq('user_id', userId)
      .maybeSingle();

    const secretId = await storeCookie(userId, liAt);

    const { error: upsertErr } = await svc.from('linkedin_accounts').upsert(
      {
        user_id: userId,
        li_secret_id: secretId,
        status: 'connected',
        proxy_country: proxyCountry,
        last_validated: null,
      },
      { onConflict: 'user_id' }
    );
    if (upsertErr) throw new Error(upsertErr.message);

    // Best-effort cleanup of the previous secret (after the new one is wired up).
    if (existing?.li_secret_id && existing.li_secret_id !== secretId) {
      try {
        await deleteCookie(existing.li_secret_id);
      } catch {
        /* non-fatal: old secret left in Vault */
      }
    }

    await svc.from('send_log').insert({
      user_id: userId,
      event: 'session_connected',
      detail: { proxyCountry },
    });

    // NOTE: response intentionally contains no cookie material.
    return json({ ok: true, status: 'connected' });
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/linkedin/connect — disconnect: purge the Vault secret and mark
 * the account disconnected.
 */
export async function DELETE() {
  try {
    const userId = await requireUserId();
    const svc = createSupabaseServiceClient();
    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('li_secret_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (account?.li_secret_id) {
      try {
        await deleteCookie(account.li_secret_id);
      } catch {
        /* non-fatal */
      }
    }
    await svc
      .from('linkedin_accounts')
      .update({ status: 'disconnected', li_secret_id: null })
      .eq('user_id', userId);

    return json({ ok: true, status: 'disconnected' });
  } catch (err) {
    return errorResponse(err);
  }
}
