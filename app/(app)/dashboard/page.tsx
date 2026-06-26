import Link from 'next/link';
import { requireAccountId } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { capStatus } from '@/lib/caps';
import { DAILY_MESSAGE_LIMIT } from '@/lib/limits';
import { IconUsers, IconSend, IconMail, IconPlus } from '@/app/components/icons';

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

  // Recent leads + activity to fill the page.
  const { data: recentLeads } = await svc
    .from('leads')
    .select('id, first_name, last_name, current_title, current_company, enriched_at, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(6);
  const { data: events } = await svc
    .from('send_log')
    .select('event, created_at')
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(7);

  const caps = capStatus(usage?.dms_sent ?? 0, DAILY_MESSAGE_LIMIT);
  const pct = caps.cap > 0 ? Math.min(100, Math.round((caps.sent / caps.cap) * 100)) : 0;
  const reauth = account?.status === 'needs_reauth';
  const eventLabel: Record<string, string> = {
    session_connected: 'LinkedIn connected',
    dm_sent: 'Message sent',
    send_failed: 'Send failed',
    send_auth_failure: 'Session expired',
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Overview</h1>
          <div className="sub">Track your LinkedIn outreach &amp; performance</div>
        </div>
        <div className="spacer" />
        <Link className="btn" href="/leads">
          <IconPlus /> Find leads
        </Link>
      </div>

      {reauth && (
        <div className="notice warn">
          Your LinkedIn session needs reconnecting. <Link href="/">Reconnect →</Link>
        </div>
      )}

      <div className="grid cols-3" style={{ marginBottom: 18 }}>
        <div className="stat-card">
          <div className="stat-icon"><IconUsers /></div>
          <div className="stat-num">{leads ?? 0}</div>
          <div className="stat-label">Leads</div>
          <div className="stat-sub">saved to your list</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon green"><IconSend /></div>
          <div className="stat-num">
            {caps.sent} <span style={{ fontSize: 17, color: 'var(--muted)', fontWeight: 600 }}>/ {caps.cap}</span>
          </div>
          <div className="stat-label">Sent today</div>
          <div className="stat-sub">{caps.reached ? 'daily limit reached' : `${caps.remaining} remaining`}</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon"><IconMail /></div>
          <div className="stat-num">{sent ?? 0}</div>
          <div className="stat-label">Total sent</div>
          <div className="stat-sub">{drafts ?? 0} drafts waiting</div>
        </div>
      </div>

      <div className="split">
        {/* Left: recent leads */}
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>Recent leads</h2>
            <Link href="/leads" style={{ fontSize: 13 }}>View all →</Link>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th>Title / Company</th><th>Enriched</th></tr>
              </thead>
              <tbody>
                {(recentLeads ?? []).map((l) => (
                  <tr key={l.id}>
                    <td>{[l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead'}</td>
                    <td className="muted">{l.current_title ?? '—'}{l.current_company ? ` · ${l.current_company}` : ''}</td>
                    <td>{l.enriched_at ? <span className="badge good">yes</span> : <span className="badge plain">no</span>}</td>
                  </tr>
                ))}
                {(!recentLeads || recentLeads.length === 0) && (
                  <tr><td colSpan={3} className="muted">No leads yet — <Link href="/leads">sync your connections</Link>.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: daily progress + activity */}
        <div>
          <div className="card">
            <h2>Today&apos;s sending</h2>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="stat-num" style={{ fontSize: 26 }}>{caps.sent}<span style={{ color: 'var(--muted)', fontWeight: 600, fontSize: 16 }}> / {caps.cap}</span></span>
              <span className="badge plain">{pct}%</span>
            </div>
            <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999, marginTop: 12, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }} />
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 12 }}>
              Target: <strong>{account?.leads_to_message ?? 0}</strong> leads. <Link href="/settings">Adjust →</Link>
            </p>
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <h2>Recent activity</h2>
            {(events ?? []).length === 0 ? (
              <p className="muted" style={{ fontSize: 13 }}>Nothing yet.</p>
            ) : (
              (events ?? []).map((e, i) => (
                <div key={i} className="row" style={{ justifyContent: 'space-between', padding: '7px 0', borderBottom: i < (events!.length - 1) ? '1px solid var(--border)' : 'none' }}>
                  <span style={{ fontSize: 13.5 }}>{eventLabel[e.event ?? ''] ?? e.event}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{new Date(e.created_at).toLocaleDateString()}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
