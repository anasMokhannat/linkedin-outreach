import { type NextRequest } from 'next/server';
import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import type { StagedConnection } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/connections?q=&company=&role= — staged connections (from the latest
 * sync) with Tier-1 filtering. Account-scoped; marks which are already leads.
 */
export async function GET(req: NextRequest) {
  try {
    const accountId = await requireAccountId();
    const svc = createSupabaseServiceClient();
    const reqUrl = new URL(req.url);

    // Lightweight metadata (no big jsonb fetch) — used by the Leads page to
    // decide whether to auto-sync without pulling all staged connections.
    if (reqUrl.searchParams.get('meta')) {
      const { data: meta } = await svc
        .from('linkedin_accounts')
        .select('last_sync_status, last_sync_at, staged_count')
        .eq('id', accountId)
        .maybeSingle();
      return json({
        status: meta?.last_sync_status ?? 'none',
        lastSyncAt: meta?.last_sync_at ?? null,
        count: meta?.staged_count ?? 0,
      });
    }

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('last_sync_status, last_sync_at, staged_connections')
      .eq('id', accountId)
      .maybeSingle();

    if (!account || !Array.isArray(account.staged_connections)) {
      return json({ status: account?.last_sync_status ?? 'none', lastSyncAt: account?.last_sync_at ?? null, connections: [] });
    }

    let connections = account.staged_connections as StagedConnection[];
    const url = new URL(req.url);
    const q = url.searchParams.get('q')?.toLowerCase().trim();
    const company = url.searchParams.get('company')?.toLowerCase().trim();
    const role = url.searchParams.get('role')?.toLowerCase().trim();
    if (q) connections = connections.filter((c) => c.fullName.toLowerCase().includes(q));
    if (company)
      connections = connections.filter(
        (c) => (c.company ?? '').toLowerCase().includes(company) || (c.headline ?? '').toLowerCase().includes(company)
      );
    if (role)
      connections = connections.filter(
        (c) => (c.title ?? '').toLowerCase().includes(role) || (c.headline ?? '').toLowerCase().includes(role)
      );

    const { data: existing } = await svc.from('leads').select('profile_url').eq('account_id', accountId);
    const persisted = new Set((existing ?? []).map((l) => l.profile_url));

    return json({
      status: account.last_sync_status ?? 'succeeded',
      lastSyncAt: account.last_sync_at ?? null,
      total: connections.length,
      connections: connections.slice(0, 1000).map((c) => ({ ...c, alreadyLead: persisted.has(c.profileUrl) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
