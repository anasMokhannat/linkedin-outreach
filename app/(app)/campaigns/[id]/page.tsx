'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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

const AVATAR_COLORS = ['#2bb3e0', '#4361ee', '#16a34a', '#b45309', '#9333ea', '#db2777', '#0891b2', '#ca8a04'];
function avatarColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
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
  const [activeId, setActiveId] = useState<string | null>(null);

  // Add-leads modal
  const [addOpen, setAddOpen] = useState(false);
  const [allLeads, setAllLeads] = useState<Array<{ id: string; first_name: string | null; last_name: string | null; current_title: string | null; current_company: string | null }>>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');

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

  async function regenerate(campaignLeadId: string) {
    setBusy(true);
    setMsg(null);
    const res = await fetch(`/api/campaigns/${id}/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ campaignLeadId }),
    });
    const data = await res.json();
    setBusy(false);
    setMsg(res.ok ? 'Regenerated the message.' : 'Regenerate failed: ' + (data.error ?? res.status));
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

  async function openAddLeads() {
    setQ('');
    setPicked(new Set());
    const res = await fetch('/api/leads');
    const data = await res.json();
    setAllLeads(data.leads ?? []);
    setAddOpen(true);
  }
  async function addLeads() {
    const leadIds = Array.from(picked);
    if (!leadIds.length) return;
    const res = await fetch(`/api/campaigns/${id}/leads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadIds }),
    });
    const data = await res.json();
    setAddOpen(false);
    setMsg(res.ok ? `Added ${data.added} lead(s).` : 'Failed: ' + (data.error ?? res.status));
    if (res.ok) load();
  }

  if (!campaign) return <div className="card muted">{msg ?? 'Loading…'}</div>;

  const counts = leads.reduce<Record<string, number>>((a, l) => ({ ...a, [l.status]: (a[l.status] ?? 0) + 1 }), {});
  const name = (l: CLead['leads']) => [l?.first_name, l?.last_name].filter(Boolean).join(' ') || 'Lead';
  const badge = (s: string) => (s === 'sent' ? 'good' : s === 'failed' ? 'bad' : s === 'approved' ? 'warn' : 'plain');
  const effectiveId = activeId ?? leads[0]?.id ?? null;
  const activeLead = leads.find((l) => l.id === effectiveId) ?? null;
  const isEditing = !!(effectiveId && effectiveId in editing);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <div className="row" style={{ gap: 10 }}>
            <h1 style={{ margin: 0 }}>{campaign.name}</h1>
            <span className={`badge ${campaign.status === 'active' ? 'good' : campaign.status === 'paused' ? 'warn' : 'plain'}`} style={{ alignSelf: 'center' }}>{campaign.status}</span>
          </div>
        </div>
        <div className="spacer" />
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
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
          <button className="btn ghost" onClick={remove}>Delete</button>
        </div>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {/* Context bar: CTA / offer + sending usage */}
      <div className="card" style={{ display: 'flex', gap: 20, flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div style={{ minWidth: 0, flex: '1 1 340px' }}>
          <p style={{ margin: 0 }}><strong>CTA:</strong> <span className="muted">{campaign.cta || '—'}</span></p>
          <p style={{ margin: '6px 0 0' }}><strong>Offer:</strong> <span className="muted">{campaign.offer || '—'}</span></p>
        </div>
        {usage && (
          <div style={{ flex: '0 0 220px' }}>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span className="muted">Today</span><strong>{usage.sentToday} / {limits.daily}</strong>
            </div>
            <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, margin: '5px 0 10px', overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, (usage.sentToday / limits.daily) * 100)}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-2))' }} />
            </div>
            <div className="row" style={{ justifyContent: 'space-between', fontSize: 13 }}>
              <span className="muted">This week</span><strong>{usage.sentThisWeek} / {limits.weekly}</strong>
            </div>
            <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, marginTop: 5, overflow: 'hidden' }}>
              <div style={{ width: `${Math.min(100, (usage.sentThisWeek / limits.weekly) * 100)}%`, height: '100%', background: 'linear-gradient(90deg,var(--accent),var(--accent-2))' }} />
            </div>
          </div>
        )}
      </div>

      {/* Master-detail: contacts | message */}
      <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 'var(--r-card)', overflow: 'hidden', background: 'var(--surface)', boxShadow: 'var(--shadow-sm)', height: 'calc(100vh - var(--topbar-h) - 330px)', minHeight: 440 }}>
        {/* Contacts */}
        <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div className="row" style={{ justifyContent: 'space-between', padding: '10px 12px 10px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{leads.length} contact{leads.length === 1 ? '' : 's'}</span>
            <button className="btn sm" onClick={openAddLeads}>+ Add leads</button>
          </div>
          <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
            {leads.map((l) => {
              const nm = name(l.leads);
              return (
                <button key={l.id} className={`chat-item ${effectiveId === l.id ? 'on' : ''}`} onClick={() => setActiveId(l.id)}>
                  <span className="avatar-c" style={{ width: 34, height: 34, fontSize: 12, background: avatarColor(nm) }}>{initials(nm)}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span style={{ display: 'block', fontWeight: 600, fontSize: 14, color: effectiveId === l.id ? 'var(--accent)' : 'var(--text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nm}</span>
                    <span className="muted" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.leads?.current_company || l.leads?.current_title || ''}</span>
                  </span>
                  <span className={`badge ${badge(l.status)}`} style={{ flexShrink: 0, fontSize: 10 }}>{l.status}</span>
                </button>
              );
            })}
            {leads.length === 0 && <p className="muted" style={{ padding: 16, fontSize: 13 }}>No leads in this campaign.</p>}
          </div>
        </div>

        {/* Message detail */}
        <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
          {activeLead ? (
            <div style={{ padding: '20px 24px' }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div className="row" style={{ gap: 12, minWidth: 0 }}>
                  <span className="avatar-c" style={{ width: 46, height: 46, fontSize: 16, background: avatarColor(name(activeLead.leads)) }}>{initials(name(activeLead.leads))}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 17 }}>{name(activeLead.leads)}</div>
                    <div className="muted" style={{ fontSize: 13 }}>{[activeLead.leads?.current_title, activeLead.leads?.current_company].filter(Boolean).join(' · ') || '—'}</div>
                    {activeLead.leads?.profile_url && <a href={activeLead.leads.profile_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5 }}>View LinkedIn ↗</a>}
                  </div>
                </div>
                <span className={`badge ${badge(activeLead.status)}`}>{activeLead.status}</span>
              </div>

              {activeLead.status === 'approved' && <div className="notice good" style={{ marginTop: 14 }}>Approved — will send on schedule.</div>}
              {activeLead.sent_at && <p className="muted" style={{ fontSize: 12.5, marginTop: 12 }}>Sent {new Date(activeLead.sent_at).toLocaleString()}</p>}
              {activeLead.error && <div className="notice bad" style={{ marginTop: 12 }}>{activeLead.error}</div>}

              <div className="drawer-section-title" style={{ border: 'none', paddingTop: 0 }}>Generated message</div>
              {isEditing ? (
                <textarea rows={12} value={editing[effectiveId!]} onChange={(e) => setEditing((p) => ({ ...p, [effectiveId!]: e.target.value }))} />
              ) : activeLead.messages?.body ? (
                <div className="card" style={{ boxShadow: 'none', background: 'var(--surface-2)', border: '1px solid var(--border)', marginBottom: 0 }}>
                  <p style={{ whiteSpace: 'pre-wrap', margin: 0, fontSize: 14, lineHeight: 1.65 }}>{activeLead.messages.body}</p>
                </div>
              ) : (
                <p className="muted" style={{ fontSize: 13 }}>No message generated yet. Use “Generate messages” above.</p>
              )}

              {/* Review actions */}
              <div className="row" style={{ gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
                {isEditing ? (
                  <>
                    <button className="btn" disabled={!editing[effectiveId!].trim()} onClick={() => review(effectiveId!, 'edit', editing[effectiveId!].trim())}>Save</button>
                    <button className="btn ghost" onClick={() => setEditing((p) => { const n = { ...p }; delete n[effectiveId!]; return n; })}>Cancel</button>
                  </>
                ) : (activeLead.status === 'generated' || activeLead.status === 'approved') ? (
                  <>
                    {activeLead.status === 'generated' && <button className="btn" onClick={() => review(activeLead.id, 'approve')}>Approve</button>}
                    {activeLead.messages?.body && <button className="btn secondary" onClick={() => setEditing((p) => ({ ...p, [activeLead.id]: activeLead.messages!.body }))}>Edit</button>}
                    <button className="btn secondary" onClick={() => regenerate(activeLead.id)} disabled={busy}>Regenerate</button>
                    <button className="btn ghost" onClick={() => review(activeLead.id, 'skip')}>Skip</button>
                  </>
                ) : activeLead.messages?.body ? (
                  <button className="btn secondary" onClick={() => regenerate(activeLead.id)} disabled={busy}>Regenerate</button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="chat-empty">Select a contact to view its message.</div>
          )}
        </div>
      </div>

      {/* Add-leads modal */}
      {addOpen && (() => {
        const inCampaign = new Set(leads.map((l) => l.lead_id));
        const ql = q.toLowerCase().trim();
        const available = allLeads
          .filter((l) => !inCampaign.has(l.id))
          .filter((l) => !ql || [l.first_name, l.last_name, l.current_company, l.current_title].filter(Boolean).join(' ').toLowerCase().includes(ql));
        return (
          <div className="modal-backdrop" onClick={() => setAddOpen(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h2 style={{ margin: 0 }}>Add leads to campaign</h2>
                <button className="btn ghost sm" onClick={() => setAddOpen(false)}>Close</button>
              </div>
              <input placeholder="Search leads" value={q} onChange={(e) => setQ(e.target.value)} style={{ margin: '12px 0 8px' }} />
              <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-ctl)' }}>
                <table>
                  <tbody>
                    {available.map((l) => {
                      const nm = [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead';
                      return (
                        <tr key={l.id} onClick={() => setPicked((p) => { const n = new Set(p); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })} style={{ cursor: 'pointer' }}>
                          <td style={{ width: 36 }}><input type="checkbox" style={{ width: 'auto' }} checked={picked.has(l.id)} readOnly /></td>
                          <td>{nm}</td>
                          <td className="muted">{l.current_title ?? '—'}{l.current_company ? ` · ${l.current_company}` : ''}</td>
                        </tr>
                      );
                    })}
                    {available.length === 0 && <tr><td className="muted">{allLeads.length === 0 ? 'No leads yet — add some on the Leads page.' : 'All your leads are already in this campaign.'}</td></tr>}
                  </tbody>
                </table>
              </div>
              <button className="btn" style={{ marginTop: 16 }} disabled={picked.size === 0} onClick={addLeads}>
                Add {picked.size || ''} lead{picked.size === 1 ? '' : 's'}
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
