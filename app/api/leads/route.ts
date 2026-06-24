import { type NextRequest } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * GET /api/leads?location=&school=&industry=&enriched=
 * Lists the user's persisted leads with Tier-2 filters (usable after enrichment).
 */
export async function GET(req: NextRequest) {
  try {
    await requireUserId();
    const supabase = createSupabaseServerClient();
    const url = new URL(req.url);

    let query = supabase
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);

    const location = url.searchParams.get('location')?.trim();
    const school = url.searchParams.get('school')?.trim();
    const industry = url.searchParams.get('industry')?.trim();
    if (location) query = query.ilike('location', `%${location}%`);
    if (school) query = query.ilike('school', `%${school}%`);
    if (industry) query = query.ilike('industry', `%${industry}%`);
    if (url.searchParams.get('enriched') === 'true') query = query.not('enriched_at', 'is', null);

    const { data: leads, error } = await query;
    if (error) throw new Error(error.message);

    // Which leads already have a non-rejected message?
    const { data: msgs } = await supabase
      .from('messages')
      .select('lead_id, status')
      .neq('status', 'rejected');
    const withMsg = new Map<string, string>();
    (msgs ?? []).forEach((m) => withMsg.set(m.lead_id, m.status));

    return json({
      leads: (leads ?? []).map((l) => ({ ...l, messageStatus: withMsg.get(l.id) ?? null })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
