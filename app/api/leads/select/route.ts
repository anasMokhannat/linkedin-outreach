import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import type { StagedConnection } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * POST /api/leads/select  { connections: StagedConnection[] }
 *
 * The FIRST persistence point: only the connections the user explicitly selects
 * become rows in `leads`. Everything else stays transient in the Apify dataset.
 *
 * Uses the RLS-bound client (acts as the user), so inserts are naturally scoped.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const body = (await req.json().catch(() => ({}))) as { connections?: unknown };

    if (!Array.isArray(body.connections) || body.connections.length === 0) {
      throw new HttpError(400, 'No connections selected.');
    }
    if (body.connections.length > 1000) {
      throw new HttpError(400, 'Too many at once (max 1000).');
    }

    const rows = (body.connections as StagedConnection[])
      .filter((c) => c && typeof c.profileUrl === 'string' && c.profileUrl)
      .map((c) => ({
        user_id: userId,
        profile_url: c.profileUrl,
        first_name: c.firstName ?? null,
        last_name: c.lastName ?? null,
        headline: c.headline ?? null,
        current_company: c.company ?? null,
        current_title: c.title ?? null,
      }));

    if (rows.length === 0) throw new HttpError(400, 'No valid connections in payload.');

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('leads')
      .upsert(rows, { onConflict: 'user_id,profile_url', ignoreDuplicates: true })
      .select('id');

    if (error) throw new Error(error.message);

    return json({ ok: true, inserted: data?.length ?? 0, requested: rows.length });
  } catch (err) {
    return errorResponse(err);
  }
}
