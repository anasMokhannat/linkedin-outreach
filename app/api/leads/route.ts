import { type NextRequest } from 'next/server';
import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/leads?location=&school=&industry=&enriched=
 * Lists the account's leads (account-scoped) with Tier-2 filters + message status.
 */
export async function GET(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const url = new URL(req.url);

    let query = svc
      .from('leads')
      .select('*')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false })
      .limit(500);

    const industry = url.searchParams.get('industry')?.trim();
    const company = url.searchParams.get('company')?.trim();
    const title = url.searchParams.get('title')?.trim();
    const name = url.searchParams.get('name')?.trim();
    if (industry) query = query.ilike('industry', `%${industry}%`);
    if (company) query = query.ilike('current_company', `%${company}%`);
    if (title) query = query.ilike('current_title', `%${title}%`);
    if (name) query = query.or(`first_name.ilike.%${name}%,last_name.ilike.%${name}%`);
    if (url.searchParams.get('enriched') === 'true') query = query.not('enriched_at', 'is', null);

    const { data: leads, error } = await query;
    if (error) throw new Error(error.message);

    // Message counts per lead (for the "View messages" affordance).
    const { data: msgs } = await svc
      .from('messages')
      .select('lead_id, status')
      .eq('account_id', accountId);
    const counts = new Map<string, { total: number; last: string | null }>();
    (msgs ?? []).forEach((m) => {
      const c = counts.get(m.lead_id) ?? { total: 0, last: null };
      c.total += 1;
      c.last = m.status;
      counts.set(m.lead_id, c);
    });

    return json({
      leads: (leads ?? []).map((l) => ({
        ...l,
        messageCount: counts.get(l.id)?.total ?? 0,
        lastMessageStatus: counts.get(l.id)?.last ?? null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
