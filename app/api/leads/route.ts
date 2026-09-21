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

    // Explicit column list — exclude the heavy enrichment jsonb (summary,
    // experiences, education, skills, company, recent_posts, raw); those are
    // fetched per-lead via GET /api/leads/:id for the profile drawer.
    let query = svc
      .from('leads')
      .select(
        'id, account_id, profile_url, provider_member_id, first_name, last_name, headline, current_company, current_title, location, school, industry, email, known, company_size, enriched_at, provider_chat_id, created_at'
      )
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
    if (name) {
      // Strip PostgREST filter metacharacters to avoid filter injection.
      const safe = name.replace(/[(),*]/g, ' ').trim();
      if (safe) query = query.or(`first_name.ilike.%${safe}%,last_name.ilike.%${safe}%`);
    }
    if (url.searchParams.get('enriched') === 'true') query = query.not('enriched_at', 'is', null);

    // Latest message per lead (for the preview / status in the send flow).
    // Independent of the leads query → run both in parallel.
    const msgsQuery = svc
      .from('messages')
      .select('lead_id, status, body, created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: false });

    const [{ data: leads, error }, { data: msgs }] = await Promise.all([query, msgsQuery]);
    if (error) throw new Error(error.message);

    const latest = new Map<string, { status: string; body: string }>();
    (msgs ?? []).forEach((m) => {
      if (!latest.has(m.lead_id)) latest.set(m.lead_id, { status: m.status, body: m.body });
    });

    return json({
      leads: (leads ?? []).map((l) => ({
        ...l,
        messageStatus: latest.get(l.id)?.status ?? null,
        messageBody: latest.get(l.id)?.body ?? null,
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
