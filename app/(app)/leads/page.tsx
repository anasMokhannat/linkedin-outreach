'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Lead {
  id: string;
  profile_url: string;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  current_company: string | null;
  current_title: string | null;
  location: string | null;
  industry: string | null;
  enriched_at: string | null;
  messageCount: number;
  lastMessageStatus: string | null;
}
interface Staged {
  profileUrl: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  company?: string;
  title?: string;
  providerId?: string;
  alreadyLead?: boolean;
}
interface Msg {
  id: string;
  body: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}

function name(l: { first_name: string | null; last_name: string | null }) {
  return [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead';
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // Tier-2 filters
  const [location, setLocation] = useState('');
  const [industry, setIndustry] = useState('');

  // Add-from-connections
  const [showConns, setShowConns] = useState(false);
  const [conns, setConns] = useState<Staged[]>([]);
  const [syncStatus, setSyncStatus] = useState<string>('none');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Modals
  const [msgsModal, setMsgsModal] = useState<{ lead: Lead; items: Msg[] } | null>(null);
  const [profileModal, setProfileModal] = useState<{ lead: Lead; enrichment: Record<string, unknown> | null } | null>(null);

  const loadLeads = useCallback(async () => {
    const params = new URLSearchParams();
    if (location) params.set('location', location);
    if (industry) params.set('industry', industry);
    const res = await fetch('/api/leads?' + params.toString());
    const data = await res.json();
    setLeads(data.leads ?? []);
  }, [location, industry]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  const setLeadBusy = (id: string, v: boolean) => setBusy((p) => ({ ...p, [id]: v }));

  async function loadConnections() {
    const res = await fetch('/api/connections');
    const data = await res.json();
    setSyncStatus(data.status ?? 'none');
    setConns(data.connections ?? []);
  }

  async function sync() {
    setMsg(null);
    setBusy((p) => ({ ...p, sync: true }));
    const res = await fetch('/api/sync/connections', { method: 'POST' });
    const data = await res.json();
    setBusy((p) => ({ ...p, sync: false }));
    if (!res.ok) setMsg('Sync failed: ' + (data.error ?? res.status));
    else {
      setMsg(`Synced ${data.count} connections.`);
      setShowConns(true);
      loadConnections();
    }
  }

  const filteredConns = useMemo(() => {
    const ql = q.toLowerCase();
    return conns.filter((c) => !ql || c.fullName.toLowerCase().includes(ql));
  }, [conns, q]);

  async function addSelected() {
    const chosen = filteredConns.filter((c) => selected.has(c.profileUrl) && !c.alreadyLead);
    if (!chosen.length) return setMsg('Nothing new selected.');
    const res = await fetch('/api/leads/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connections: chosen }),
    });
    const data = await res.json();
    if (!res.ok) setMsg('Save failed: ' + (data.error ?? res.status));
    else {
      setMsg(`Added ${data.inserted} lead(s).`);
      setSelected(new Set());
      loadConnections();
      loadLeads();
    }
  }

  async function enrich(id: string) {
    setMsg(null);
    setLeadBusy(id, true);
    const res = await fetch(`/api/leads/${id}/enrich`, { method: 'POST' });
    const data = await res.json();
    setLeadBusy(id, false);
    if (!res.ok) setMsg('Enrich failed: ' + (data.error ?? res.status));
    else {
      setMsg('Enriched.');
      loadLeads();
    }
  }

  async function generate(id: string) {
    setMsg(null);
    setLeadBusy(id, true);
    const res = await fetch('/api/messages/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadId: id }),
    });
    const data = await res.json();
    setLeadBusy(id, false);
    if (!res.ok) setMsg('Generate failed: ' + (data.error ?? res.status));
    else {
      setMsg('Draft created — open Messages to approve & send.');
      loadLeads();
    }
  }

  async function openMessages(lead: Lead) {
    const res = await fetch(`/api/leads/${lead.id}/messages`);
    const data = await res.json();
    setMsgsModal({ lead, items: data.messages ?? [] });
  }

  async function refreshMessages(lead: Lead) {
    const res = await fetch(`/api/leads/${lead.id}/messages`);
    const data = await res.json();
    setMsgsModal({ lead, items: data.messages ?? [] });
    loadLeads();
  }

  async function patchMsg(lead: Lead, id: string, action: string) {
    const res = await fetch(`/api/messages/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    });
    if (!res.ok) {
      const d = await res.json();
      setMsg(`${action} failed: ${d.error ?? res.status}`);
    } else refreshMessages(lead);
  }

  async function sendMsg(lead: Lead, id: string) {
    const res = await fetch(`/api/messages/${id}/send`, { method: 'POST' });
    const d = await res.json();
    if (res.status === 429) setMsg('Daily limit reached — continue tomorrow.');
    else if (!res.ok) setMsg('Send failed: ' + (d.error ?? res.status));
    else {
      setMsg('Message sent.');
      refreshMessages(lead);
    }
  }

  async function openProfile(lead: Lead) {
    const res = await fetch(`/api/leads/${lead.id}`);
    const data = await res.json();
    setProfileModal({ lead, enrichment: data.enrichment });
  }

  async function removeLead(id: string) {
    if (!confirm('Delete this lead?')) return;
    await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    loadLeads();
  }

  function toggle(url: string) {
    setSelected((p) => {
      const n = new Set(p);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });
  }

  const badge = (s: string | null) =>
    s === 'sent' ? 'good' : s === 'failed' || s === 'rejected' ? 'bad' : s === 'approved' ? 'warn' : 'plain';

  return (
    <div>
      <div className="hero">
        <div>
          <h1>Leads</h1>
          <div className="sub">Your 1st-degree connections, enriched and contacted</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={sync} disabled={busy.sync}>
          {busy.sync ? 'Syncing…' : '⇄ Sync connections'}
        </button>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {/* Add from connections */}
      {(showConns || conns.length > 0) && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Add from connections</h2>
            <button className="btn ghost sm" onClick={() => setShowConns((v) => !v)}>
              {showConns ? 'Hide' : 'Show'}
            </button>
          </div>
          {showConns && (
            <>
              <div className="row" style={{ margin: '12px 0' }}>
                <input placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 280 }} />
                <button className="btn" onClick={addSelected} disabled={selected.size === 0}>
                  Add {selected.size || ''} selected
                </button>
                <span className="muted">{syncStatus === 'none' ? 'Run a sync first' : `${filteredConns.length} shown`}</span>
              </div>
              <div style={{ overflowX: 'auto', maxHeight: 320, overflowY: 'auto' }}>
                <table>
                  <thead><tr><th></th><th>Name</th><th>Headline</th></tr></thead>
                  <tbody>
                    {filteredConns.slice(0, 200).map((c) => (
                      <tr key={c.profileUrl}>
                        <td style={{ width: 36 }}>
                          {c.alreadyLead ? <span className="badge good plain">✓</span> : (
                            <input type="checkbox" style={{ width: 'auto' }} checked={selected.has(c.profileUrl)} onChange={() => toggle(c.profileUrl)} />
                          )}
                        </td>
                        <td><a href={c.profileUrl} target="_blank" rel="noreferrer">{c.fullName}</a></td>
                        <td className="muted">{c.headline ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tier-2 filters */}
      <div className="card">
        <div className="row">
          <input placeholder="Filter by location" value={location} onChange={(e) => setLocation(e.target.value)} style={{ maxWidth: 220 }} />
          <input placeholder="Filter by industry" value={industry} onChange={(e) => setIndustry(e.target.value)} style={{ maxWidth: 220 }} />
          <button className="btn secondary" onClick={loadLeads}>Apply</button>
        </div>
      </div>

      {/* Leads table */}
      <div className="card">
        <h2>{leads.length} lead{leads.length === 1 ? '' : 's'}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr><th>Name</th><th>Title / Company</th><th>Location</th><th>Enriched</th><th>Messages</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <a href={l.profile_url} target="_blank" rel="noreferrer">{name(l)}</a>
                  </td>
                  <td className="muted">{l.current_title ?? '—'}{l.current_company ? ` · ${l.current_company}` : ''}</td>
                  <td className="muted">{l.location ?? '—'}</td>
                  <td>{l.enriched_at ? <span className="badge good">yes</span> : <span className="badge plain">no</span>}</td>
                  <td>
                    {l.messageCount > 0 ? (
                      <button className="btn ghost sm" onClick={() => openMessages(l)}>
                        View ({l.messageCount}) {l.lastMessageStatus ? <span className={`badge ${badge(l.lastMessageStatus)}`}>{l.lastMessageStatus}</span> : null}
                      </button>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn secondary sm" onClick={() => enrich(l.id)} disabled={busy[l.id]}>Enrich</button>
                      {l.enriched_at && <button className="btn secondary sm" onClick={() => openProfile(l)}>Profile</button>}
                      <button className="btn sm" onClick={() => generate(l.id)} disabled={busy[l.id]}>Generate</button>
                      <button className="btn ghost sm" onClick={() => removeLead(l.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && (
                <tr><td colSpan={6} className="muted">No leads yet — Sync connections and add some.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Messages modal (#4) */}
      {msgsModal && (
        <div className="modal-backdrop" onClick={() => setMsgsModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Messages · {name(msgsModal.lead)}</h2>
              <button className="btn ghost sm" onClick={() => setMsgsModal(null)}>Close</button>
            </div>
            {msgsModal.items.length === 0 && <p className="muted">No messages yet. Use “Generate”.</p>}
            {msgsModal.items.map((m) => (
              <div key={m.id} className="card" style={{ boxShadow: 'none', marginTop: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className={`badge ${badge(m.status)}`}>{m.status}</span>
                  <span className="muted" style={{ fontSize: 12 }}>{new Date(m.created_at).toLocaleString()}</span>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', marginBottom: 8 }}>{m.body}</p>
                <div className="row" style={{ gap: 6 }}>
                  {m.status === 'draft' && <button className="btn sm" onClick={() => patchMsg(msgsModal.lead, m.id, 'approve')}>Approve</button>}
                  {m.status === 'approved' && <button className="btn sm" onClick={() => sendMsg(msgsModal.lead, m.id)}>Send</button>}
                  {['draft', 'approved'].includes(m.status) && <button className="btn ghost sm" onClick={() => patchMsg(msgsModal.lead, m.id, 'reject')}>Reject</button>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profile / enrichment modal (#6) */}
      {profileModal && (
        <div className="modal-backdrop" onClick={() => setProfileModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{name(profileModal.lead)}</h2>
              <button className="btn ghost sm" onClick={() => setProfileModal(null)}>Close</button>
            </div>
            <ProfileDetail enrichment={profileModal.enrichment} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileDetail({ enrichment }: { enrichment: Record<string, unknown> | null }) {
  if (!enrichment) return <p className="muted">Not enriched yet.</p>;
  const exp = (enrichment.experiences as Array<Record<string, string>>) ?? [];
  const edu = (enrichment.education as Array<Record<string, string>>) ?? [];
  const skills = (enrichment.skills as string[]) ?? [];
  const posts = (enrichment.recent_posts as Array<{ text?: string }>) ?? [];
  const summary = enrichment.summary as string | null;

  return (
    <div style={{ marginTop: 10 }}>
      {summary && <p className="muted">{summary}</p>}
      <h2 style={{ marginTop: 16 }}>Experience</h2>
      {exp.length === 0 ? <p className="muted">—</p> : exp.map((e, i) => (
        <div key={i} style={{ marginBottom: 8 }}>
          <strong>{e.title ?? 'Role'}</strong>{e.company ? ` · ${e.company}` : ''}
          <div className="muted" style={{ fontSize: 13 }}>{[e.start, e.end].filter(Boolean).join(' – ')}{e.location ? ` · ${e.location}` : ''}</div>
        </div>
      ))}
      <h2 style={{ marginTop: 16 }}>Education</h2>
      {edu.length === 0 ? <p className="muted">—</p> : edu.map((e, i) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <strong>{e.school ?? 'School'}</strong>
          <div className="muted" style={{ fontSize: 13 }}>{[e.degree, e.field].filter(Boolean).join(', ')}</div>
        </div>
      ))}
      {skills.length > 0 && (
        <>
          <h2 style={{ marginTop: 16 }}>Skills</h2>
          <div className="row" style={{ gap: 6 }}>{skills.slice(0, 30).map((s, i) => <span key={i} className="badge plain">{s}</span>)}</div>
        </>
      )}
      {posts.length > 0 && (
        <>
          <h2 style={{ marginTop: 16 }}>Recent posts</h2>
          {posts.slice(0, 3).map((p, i) => <p key={i} className="muted" style={{ fontSize: 13 }}>“{(p.text ?? '').slice(0, 200)}”</p>)}
        </>
      )}
    </div>
  );
}
