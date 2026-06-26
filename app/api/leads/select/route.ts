import { type NextRequest } from 'next/server';
import { requireAccountId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import type { StagedConnection } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * POST /api/leads/select  { connections: StagedConnection[] }
 * First persistence point — only selected connections become leads, scoped to
 * the current account.
 */
export async function POST(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const body = (await req.json().catch(() => ({}))) as { connections?: unknown };
    if (!Array.isArray(body.connections) || body.connections.length === 0) {
      throw new HttpError(400, 'No connections selected.');
    }
    if (body.connections.length > 1000) throw new HttpError(400, 'Too many at once (max 1000).');

    const rows = (body.connections as StagedConnection[])
      .filter((c) => c && typeof c.profileUrl === 'string' && c.profileUrl)
      .map((c) => ({
        account_id: accountId,
        profile_url: c.profileUrl,
        first_name: c.firstName ?? null,
        last_name: c.lastName ?? null,
        headline: c.headline ?? null,
        current_company: c.company ?? null,
        current_title: c.title ?? null,
        provider_member_id: c.providerId ?? null,
      }));
    if (rows.length === 0) throw new HttpError(400, 'No valid connections in payload.');

    const svc = createSupabaseServiceClient();
    const { data, error } = await svc
      .from('leads')
      .upsert(rows, { onConflict: 'account_id,profile_url', ignoreDuplicates: true })
      .select('id');
    if (error) throw new Error(error.message);

    return json({ ok: true, inserted: data?.length ?? 0, requested: rows.length });
  } catch (err) {
    return errorResponse(err);
  }
}
