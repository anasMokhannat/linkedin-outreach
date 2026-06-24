import { type NextRequest } from 'next/server';
import { requireUserId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { getDatasetItems } from '@/lib/apify';
import { normalizeConnection } from '@/lib/normalize';
import type { StagedConnection } from '@/lib/types';

export const runtime = 'nodejs';

/**
 * GET /api/connections?q=&company=&role=
 *
 * Reads the staged connections from the latest sync's Apify dataset (transient)
 * and applies the Tier-1 filter (name, company/role from headline). Raw
 * connections are never stored in our DB — this reads straight from Apify.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const svc = createSupabaseServiceClient();

    const { data: account } = await svc
      .from('linkedin_accounts')
      .select('last_sync_dataset_id, last_sync_status')
      .eq('user_id', userId)
      .maybeSingle();

    if (!account?.last_sync_dataset_id) {
      return json({ status: account?.last_sync_status ?? 'none', connections: [] });
    }
    if (account.last_sync_status === 'running') {
      return json({ status: 'running', connections: [] });
    }
    if (account.last_sync_status === 'failed') {
      return json({ status: 'failed', connections: [] });
    }

    const items = await getDatasetItems<Record<string, unknown>>(account.last_sync_dataset_id);
    let connections: StagedConnection[] = items
      .map(normalizeConnection)
      .filter((c): c is StagedConnection => c !== null);

    // Tier-1 filter (instant; no enrichment needed).
    const url = new URL(req.url);
    const q = url.searchParams.get('q')?.toLowerCase().trim();
    const company = url.searchParams.get('company')?.toLowerCase().trim();
    const role = url.searchParams.get('role')?.toLowerCase().trim();

    if (q) {
      connections = connections.filter((c) => c.fullName.toLowerCase().includes(q));
    }
    if (company) {
      connections = connections.filter(
        (c) =>
          (c.company ?? '').toLowerCase().includes(company) ||
          (c.headline ?? '').toLowerCase().includes(company)
      );
    }
    if (role) {
      connections = connections.filter(
        (c) =>
          (c.title ?? '').toLowerCase().includes(role) ||
          (c.headline ?? '').toLowerCase().includes(role)
      );
    }

    // Mark which staged connections are already persisted as leads.
    const { data: existingLeads } = await svc
      .from('leads')
      .select('profile_url')
      .eq('user_id', userId);
    const persisted = new Set((existingLeads ?? []).map((l) => l.profile_url));

    return json({
      status: 'succeeded',
      total: connections.length,
      connections: connections.slice(0, 1000).map((c) => ({
        ...c,
        alreadyLead: persisted.has(c.profileUrl),
      })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}
