import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * Data minimization / retention controls (spec §2 operational, §14.5).
 *
 * POST /api/data { action: 'purge_raw_enrichment' | 'delete_all' }
 *   - purge_raw_enrichment: strips the heavy `raw` blob from enrichment rows,
 *     keeping the derived recent_posts/company used for generation.
 *   - delete_all: deletes the user's leads (cascading enrichment + messages),
 *     send_queue and send_log rows. The LinkedIn session is handled separately
 *     via DELETE /api/linkedin/connect.
 *
 * TODO(confirm): auto-purge cadence for `raw` (e.g. nightly cron stripping raw
 * older than N days). Defaulting to manual purge here pending product decision.
 */
export async function POST(req: NextRequest) {
  try {
    await requireUserId();
    const { action } = (await req.json().catch(() => ({}))) as { action?: string };
    const supabase = createSupabaseServerClient();

    if (action === 'purge_raw_enrichment') {
      const { error } = await supabase
        .from('lead_enrichment')
        .update({ raw: null })
        .not('raw', 'is', null);
      if (error) throw new Error(error.message);
      return json({ ok: true, purged: 'raw' });
    }

    if (action === 'delete_all') {
      // send_log / send_queue first (no cascade from leads), then leads cascade.
      await supabase.from('send_log').delete().not('id', 'is', null);
      await supabase.from('send_queue').delete().not('id', 'is', null);
      const { error } = await supabase.from('leads').delete().not('id', 'is', null);
      if (error) throw new Error(error.message);
      return json({ ok: true, deleted: 'all' });
    }

    throw new HttpError(400, 'Unknown action.');
  } catch (err) {
    return errorResponse(err);
  }
}
