import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * POST /api/connections/dismiss  { profileUrls: string[], restore?: boolean }
 * Hide connections from the in-app list (does NOT remove the LinkedIn connection),
 * or bring them back when `restore` is true. Dismissed URLs are stored on the
 * account and filtered out when serving the list, so they stay hidden across
 * future syncs until restored. Account-scoped.
 */
export async function POST(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const body = (await req.json().catch(() => ({}))) as { profileUrls?: unknown; restore?: unknown };
    const incoming = Array.isArray(body.profileUrls)
      ? (body.profileUrls.filter((u) => typeof u === 'string' && u) as string[])
      : [];
    const restore = body.restore === true;
    if (incoming.length === 0) throw new HttpError(400, restore ? 'No connections to restore.' : 'No connections to remove.');

    const svc = createSupabaseServiceClient();
    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('dismissed_connections')
      .eq('id', accountId)
      .maybeSingle();

    const current = (Array.isArray(account?.dismissed_connections) ? account!.dismissed_connections : []) as string[];
    const remove = new Set(incoming);
    const next = restore
      ? current.filter((u) => !remove.has(u)) // un-dismiss
      : Array.from(new Set([...current, ...incoming])); // dismiss

    const { error } = await svc
      .from('linkedin_accounts')
      .update({ dismissed_connections: next })
      .eq('id', accountId);
    if (error) throw new Error(error.message);

    return json({ ok: true, [restore ? 'restored' : 'dismissed']: incoming.length });
  } catch (err) {
    return errorResponse(err);
  }
}
