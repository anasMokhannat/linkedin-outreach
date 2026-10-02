import { type NextRequest } from 'next/server';
import { requireAccountId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { matchesICP } from '@/lib/playbook';
import type { StagedConnection } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/connections — staged connections (from the latest sync) filtered
 * server-side to FLUGIA's ICP (in-code, not user-facing). Account-scoped; marks
 * which are already leads.
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
      .select('last_sync_status, last_sync_at, staged_connections, dismissed_connections')
      .eq('id', accountId)
      .maybeSingle();

    if (!account || !Array.isArray(account.staged_connections)) {
      return json({ status: account?.last_sync_status ?? 'none', lastSyncAt: account?.last_sync_at ?? null, connections: [] });
    }

    const all = account.staged_connections as StagedConnection[];
    // Profile URLs the user removed from the list — hidden even after re-sync.
    const dismissed = new Set(
      (Array.isArray(account.dismissed_connections) ? account.dismissed_connections : []) as string[]
    );

    // "Removed" view: the connections the user has dismissed (so they can bring
    // them back). No ICP filter — show everything they removed that we still have.
    if (reqUrl.searchParams.get('view') === 'removed') {
      const removed = all.filter((c) => dismissed.has(c.profileUrl));
      return json({
        status: account.last_sync_status ?? 'succeeded',
        lastSyncAt: account.last_sync_at ?? null,
        total: removed.length,
        connections: removed,
      });
    }

    // In-code ICP filter (not exposed to the user): only surface connections
    // whose headline/title matches FLUGIA's target decision-maker roles, minus
    // any the user dismissed.
    const connections = all.filter((c) => !dismissed.has(c.profileUrl) && matchesICP(c));

    const { data: existing } = await svc.from('leads').select('profile_url').eq('account_id', accountId);
    const persisted = new Set((existing ?? []).map((l) => l.profile_url));

    return json({
      status: account.last_sync_status ?? 'succeeded',
      lastSyncAt: account.last_sync_at ?? null,
      total: connections.length,
      // No cap — the Connections page paginates client-side, so it can hold the
      // full ICP-matched set (was previously sliced to the first 1000).
      connections: connections.map((c) => ({ ...c, alreadyLead: persisted.has(c.profileUrl) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
