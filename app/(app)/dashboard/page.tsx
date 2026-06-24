import Link from 'next/link';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { getSessionUser } from '@/lib/auth';
import { capStatus, DEFAULT_CAP_CONFIG } from '@/lib/caps';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await getSessionUser();
  const supabase = createSupabaseServerClient();

  const [{ data: account }, { data: profile }] = await Promise.all([
    supabase.from('linkedin_accounts').select('*').maybeSingle(),
    supabase.from('users').select('*').maybeSingle(),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await supabase
    .from('daily_usage')
    .select('dms_sent')
    .eq('day', today)
    .maybeSingle();

  const [{ count: leadCount }, { count: draftCount }, { count: queuedCount }, { count: sentCount }] =
    await Promise.all([
      supabase.from('leads').select('id', { count: 'exact', head: true }),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('status', 'draft'),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('status', 'queued'),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('status', 'sent'),
    ]);

  const ageDays = account?.last_validated
    ? Math.floor((Date.now() - new Date(account.created_at).getTime()) / 86_400_000)
    : 0;
  const cfg = profile
    ? {
        startCap: profile.dms_start_cap ?? DEFAULT_CAP_CONFIG.startCap,
        maxCap: profile.dms_max_cap ?? DEFAULT_CAP_CONFIG.maxCap,
        rampPerWeek: profile.ramp_per_week ?? DEFAULT_CAP_CONFIG.rampPerWeek,
      }
    : DEFAULT_CAP_CONFIG;
  const caps = capStatus(ageDays, usage?.dms_sent ?? 0, cfg);

  const statusBadge =
    account?.status === 'connected'
      ? 'good'
      : account?.status === 'needs_reauth'
        ? 'warn'
        : 'bad';

  return (
    <div>
      <h1>Dashboard</h1>
      <p className="muted">Signed in as {user?.email}</p>

      {!account && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          You haven&apos;t connected a LinkedIn session yet.{' '}
          <Link href="/connections">Connect now →</Link>
        </div>
      )}

      {account?.status === 'needs_reauth' && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          Your LinkedIn session expired. Delivery is paused.{' '}
          <Link href="/connections">Reconnect →</Link>
        </div>
      )}

      <div className="grid cols-3">
        <div className="card">
          <h2>Session</h2>
          <span className={`badge ${statusBadge}`}>{account?.status ?? 'not connected'}</span>
          <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
            {account?.last_validated
              ? `Validated ${new Date(account.last_validated).toLocaleString()}`
              : 'No validation yet'}
          </p>
        </div>
        <div className="card">
          <h2>Today&apos;s cap</h2>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {caps.sent} / {caps.cap}
          </div>
          <p className="muted" style={{ fontSize: 13 }}>
            {caps.reached ? 'Daily limit reached' : `${caps.remaining} sends remaining`}
          </p>
        </div>
        <div className="card">
          <h2>Pipeline</h2>
          <div className="muted" style={{ fontSize: 14 }}>
            Leads: <strong>{leadCount ?? 0}</strong>
            <br />
            Drafts: <strong>{draftCount ?? 0}</strong> · Queued: <strong>{queuedCount ?? 0}</strong>
            <br />
            Sent: <strong>{sentCount ?? 0}</strong>
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Workflow</h2>
        <ol className="muted">
          <li>
            <Link href="/connections">Connect</Link> your session and sync connections.
          </li>
          <li>Filter (Tier-1) and select leads to persist.</li>
          <li>
            <Link href="/leads">Enrich</Link> selected leads and apply Tier-2 filters.
          </li>
          <li>
            <Link href="/messages">Generate</Link> drafts → approve → send one at a time.
          </li>
        </ol>
      </div>
    </div>
  );
}
