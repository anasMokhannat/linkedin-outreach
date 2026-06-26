import Link from 'next/link';
import { requireAccountId } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { capStatus, DEFAULT_DMS_PER_DAY } from '@/lib/caps';

export const dynamic = 'force-dynamic';

export default async function OverviewPage() {
  const accountId = await requireAccountId();
  const svc = createSupabaseServiceClient();

  const { data: account } = await svc
    .from('linkedin_accounts')
    .select('status, dms_per_day, leads_to_message, last_sync_at')
    .eq('id', accountId)
    .maybeSingle();

  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await svc
    .from('daily_usage')
    .select('dms_sent')
    .eq('account_id', accountId)
    .eq('day', today)
    .maybeSingle();

  const [{ count: leads }, { count: sent }, { count: drafts }] = await Promise.all([
    svc.from('leads').select('id', { count: 'exact', head: true }).eq('account_id', accountId),
    svc.from('messages').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'sent'),
    svc.from('messages').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('status', 'draft'),
  ]);

  const caps = capStatus(usage?.dms_sent ?? 0, account?.dms_per_day ?? DEFAULT_DMS_PER_DAY);
  const reauth = account?.status === 'needs_reauth';

  return (
    <div>
      <div className="hero">
        <div>
          <h1>Overview</h1>
          <div className="sub">Track your LinkedIn outreach & performance</div>
        </div>
        <div className="spacer" />
        <Link className="btn" href="/leads">
          + Find leads
        </Link>
      </div>

      {reauth && (
        <div className="notice warn">
          Your LinkedIn session needs reconnecting. <Link href="/">Reconnect →</Link>
        </div>
      )}

      <div className="grid cols-3" style={{ marginBottom: 18 }}>
        <div className="stat-card">
          <div className="stat-icon">◎</div>
          <div className="stat-num">{leads ?? 0}</div>
          <div className="stat-label">Leads</div>
          <div className="stat-sub">saved to your list</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green">✈</div>
          <div className="stat-num">
            {caps.sent} <span style={{ fontSize: 18, color: 'var(--muted)' }}>/ {caps.cap}</span>
          </div>
          <div className="stat-label">Sent today</div>
          <div className="stat-sub">{caps.reached ? 'daily limit reached' : `${caps.remaining} remaining`}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✉</div>
          <div className="stat-num">{sent ?? 0}</div>
          <div className="stat-label">Total sent</div>
          <div className="stat-sub">{drafts ?? 0} drafts waiting</div>
        </div>
      </div>

      <div className="card">
        <h2>Getting started</h2>
        <ol className="muted" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            <Link href="/leads">Sync your connections</Link> and add the people you want to reach.
          </li>
          <li>Enrich a lead to pull their role, experience & recent posts.</li>
          <li>Generate a message, approve it, and send — one at a time.</li>
        </ol>
        <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
          Daily cap: <strong>{account?.dms_per_day ?? DEFAULT_DMS_PER_DAY}</strong> messages ·
          target: <strong>{account?.leads_to_message ?? 0}</strong> leads.{' '}
          <Link href="/settings">Change →</Link>
        </p>
      </div>
    </div>
  );
}
