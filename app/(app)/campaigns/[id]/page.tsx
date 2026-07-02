'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useConfirm } from '@/app/components/ConfirmDialog';

interface CLead {
  id: string;
  lead_id: string;
  status: string;
  error: string | null;
  sent_at: string | null;
  leads: { first_name: string | null; last_name: string | null; current_title: string | null; current_company: string | null; profile_url: string } | null;
  messages: { body: string; status: string } | null;
}
interface Campaign {
  id: string;
  name: string;
  status: string;
  cta: string | null;
  offer: string | null;
}
interface Usage {
  sentToday: number;
  sentThisWeek: number;
  dailyRemaining: number;
  weeklyRemaining: number;
}

export default function CampaignDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const confirm = useConfirm();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [leads, setLeads] = useState<CLead[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [limits, setLimits] = useState<{ daily: number; weekly: number }>({ daily: 25, weekly: 100 });
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${id}`);
    if (!res.ok) {
      setMsg('Campaign not found.');
      return;
    }
    const data = await res.json();
    setCampaign(data.campaign);
    setLeads(data.leads ?? []);
    setUsage(data.usage ?? null);
    setLimits(data.limits ?? { daily: 25, weekly: 100 });
  }, [id]);
  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/campaigns/${id}/generate`, { method: 'POST' });
    const data = await res.json();
    setBusy(false);
    setMsg(res.ok ? `Generated ${data.generated} message(s).` : 'Generate failed: ' + (data.error ?? res.status));
    load();
  }

  async function setStatus(action: 'activate' | 'pause' | 'resume' | 'cancel') {
    if (
      action === 'cancel' &&
      !(await confirm({ title: 'Cancel campaign', message: 'Cancel this campaign? Unsent messages will be skipped.', confirmLabel: 'Cancel campaign', cancelLabel: 'Keep running', danger: true }))
    )
      return;
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/campaigns/${id}/status`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setMsg(`${action} failed: ${data.error ?? res.status}`);
    else {
      if (action === 'activate' || action === 'resume')
        setMsg(`Sent ${data.sent ?? 0} now${data.sent === 0 && data.reason === 'limit_reached' ? ' (daily limit reached)' : ''}. The rest send automatically each day.`);
      else setMsg(action === 'pause' ? 'Campaign paused.' : 'Campaign cancelled.');
      load();
    }
  }

  async function sendNow() {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/campaigns/${id}/send-now`, { method: 'POST' });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setMsg('Send failed: ' + (data.error ?? res.status));
    else setMsg(data.sent > 0 ? `Sent ${data.sent} message(s).` : data.reason === 'limit_reached' ? 'Daily/weekly limit reached.' : 'Nothing to send.');
    load();
  }

  async function review(campaignLeadId: string, action: 'approve' | 'skip' | 'edit', body?: string) {
    const res = await fetch(`/api/campaigns/${id}/review`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaignLeadId, action, body }),
    });
    if (!res.ok) {
      const d = await res.json();
      setMsg(`${action} failed: ${d.error ?? res.status}`);
    } else {
      setEditing((p) => { const n = { ...p }; delete n[campaignLeadId]; return n; });
      load();
    }
  }

  async function remove() {
    if (!(await confirm({ title: 'Delete campaign', message: 'Delete this campaign? Generated messages are removed too.', confirmLabel: 'Delete', danger: true }))) return;
    await fetch(`/api/campaigns/${id}`, { method: 'DELETE' });
    router.push('/campaigns');
  }

  if (!campaign) return <div className="card muted">{msg ?? 'Loading…'}</div>;

  const counts = leads.reduce<Record<string, number>>((a, l) => ({ ...a, [l.status]: (a[l.status] ?? 0) + 1 }), {});
  const name = (l: CLead['leads']) => [l?.first_name, l?.last_name].filter(Boolean).join(' ') || 'Lead';
  const badge = (s: string) => (s === 'sent' ? 'good' : s === 'failed' ? 'bad' : s === 'approved' ? 'warn' : 'plain');

  return (
    <div>
      {/* Compact campaign toolbar */}
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14, gap: 10 }}>
        <div className="row" style={{ gap: 10, minWidth: 0 }}>
          <h1 style={{ fontSize: 19, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{campaign.name}</h1>
          <span className={`badge ${campaign.status === 'active' ? 'good' : campaign.status === 'paused' ? 'warn' : 'plain'}`}>{campaign.status}</span>
        </div>
        <button className="btn ghost sm" onClick={remove}>Delete</button>
      </div>

      {msg && <div className="notice">{msg}</div>}

      <div className="split">
        <div>
          <div className="card">
            <h2>Targeting</h2>
            <p><strong>CTA:</strong> <span className="muted">{campaign.cta || '—'}</span></p>
            <p><strong>Offer:</strong> <span className="muted">{campaign.offer || '—'}</span></p>
            <div className="row" style={{ marginTop: 12, gap: 8 }}>
              {!!(counts.pending || counts.failed) && (
                <button className="btn secondary" onClick={generate} disabled={busy}>Generate messages</button>
              )}
              {['draft', 'paused'].includes(campaign.status) && (counts.approved > 0 || counts.generated > 0) && (
                <button className="btn" onClick={() => setStatus(campaign.status === 'paused' ? 'resume' : 'activate')} disabled={busy}>
                  {campaign.status === 'paused' ? 'Resume & send' : 'Activate & send'}
                </button>
              )}
              {campaign.status === 'active' && (
                <>
                  <button className="btn" onClick={sendNow} disabled={busy}>Send now</button>
                  <button className="btn secondary" onClick={() => setStatus('pause')} disabled={busy}>Pause</button>
                </>
              )}
              {['draft', 'active', 'paused'].includes(campaign.status) && (
                <button className="btn ghost" onClick={() => setStatus('cancel')} disabled={busy}>Cancel</button>
              )}
            </div>
            <div className="row" style={{ gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <span className="badge plain">{counts.pending ?? 0} pending</span>
              <span className="badge plain">{counts.generated ?? 0} drafted</span>
              <span className="badge warn">{counts.approved ?? 0} queued</span>
              <span className="badge good">{counts.sent ?? 0} sent</span>
              {counts.failed ? <span className="badge bad">{counts.failed} failed</span> : null}
              {counts.skipped ? <span className="badge plain">{counts.skipped} skipped</span> : null}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <h2>Leads</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Message</th><th>Status</th><th>Review</th></tr></thead>
                <tbody>
                  {leads.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <a href={l.leads?.profile_url} target="_blank" rel="noreferrer">{name(l.leads)}</a>
                        <div className="muted" style={{ fontSize: 12 }}>{l.leads?.current_title ?? ''}{l.leads?.current_company ? ` · ${l.leads.current_company}` : ''}</div>
                      </td>
                      <td className="muted" style={{ fontSize: 13, maxWidth: 360 }}>
                        {l.id in editing ? (
                          <textarea rows={4} value={editing[l.id]} onChange={(e) => setEditing((p) => ({ ...p, [l.id]: e.target.value }))} />
                        ) : (
                          l.messages?.body ? l.messages.body.slice(0, 160) + (l.messages.body.length > 160 ? '…' : '') : '—'
                        )}
                      </td>
                      <td>
                        <span className={`badge ${badge(l.status)}`}>{l.status}</span>
                        {l.sent_at && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{new Date(l.sent_at).toLocaleString()}</div>}
                      </td>
                      <td>
                        {l.id in editing ? (
                          <div className="row" style={{ gap: 6 }}>
                            <button className="btn sm" disabled={!editing[l.id].trim()} onClick={() => review(l.id, 'edit', editing[l.id].trim())}>Save</button>
                            <button className="btn ghost sm" onClick={() => setEditing((p) => { const n = { ...p }; delete n[l.id]; return n; })}>Cancel</button>
                          </div>
                        ) : (l.status === 'generated' || l.status === 'approved') ? (
                          <div className="row" style={{ gap: 6 }}>
                            {l.status === 'generated' && <button className="btn sm" onClick={() => review(l.id, 'approve')}>Approve</button>}
                            {l.messages?.body && <button className="btn secondary sm" onClick={() => setEditing((p) => ({ ...p, [l.id]: l.messages!.body }))}>Edit</button>}
                            <button className="btn ghost sm" onClick={() => review(l.id, 'skip')}>Skip</button>
                          </div>
                        ) : <span className="muted">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Sending limits</h2>
          <p className="muted" style={{ fontSize: 13 }}>App-enforced, not editable.</p>
          {usage && (
            <>
              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>Today</span><strong>{usage.sentToday} / {limits.daily}</strong>
                </div>
                <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, (usage.sentToday / limits.daily) * 100)}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-2))' }} />
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>This week</span><strong>{usage.sentThisWeek} / {limits.weekly}</strong>
                </div>
                <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999, marginTop: 6, overflow: 'hidden' }}>
                  <div style={{ width: `${Math.min(100, (usage.sentThisWeek / limits.weekly) * 100)}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-2))' }} />
                </div>
              </div>
              <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
                Active campaigns send automatically each day up to the remaining allowance ({usage.dailyRemaining} left today).
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
