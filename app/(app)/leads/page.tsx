'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconSync } from '@/app/components/icons';

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
  campaignName?: string | null;
}
interface CampaignOpt {
  id: string;
  name: string;
  status: string;
}

const STALE_MS = 24 * 60 * 60 * 1000;
function leadName(l: { first_name: string | null; last_name: string | null }) {
  return [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead';
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // Lead (post-selection) filters
  const [fIndustry, setFIndustry] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [fTitle, setFTitle] = useState('');
  const [fName, setFName] = useState('');

  // Connections (pre-selection)
  const [showConns, setShowConns] = useState(false);
  const [conns, setConns] = useState<Staged[]>([]);
  const [syncStatus, setSyncStatus] = useState<string>('none');
  const [cName, setCName] = useState('');
  const [cCompany, setCCompany] = useState('');
  const [cTitle, setCTitle] = useState('');
  const [cIndustry, setCIndustry] = useState('');
  const [selConns, setSelConns] = useState<Set<string>>(new Set());
  const autoSynced = useRef(false);

  // Lead multi-select → campaign
  const [selLeads, setSelLeads] = useState<Set<string>>(new Set());
  const [campModal, setCampModal] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignOpt[]>([]);
  const [campMode, setCampMode] = useState<'existing' | 'new'>('existing');
  const [chosenCamp, setChosenCamp] = useState('');
  const [newName, setNewName] = useState('');
  const [newCta, setNewCta] = useState('');
  const [newOffer, setNewOffer] = useState('');

  // Modals
  const [msgsModal, setMsgsModal] = useState<{ lead: Lead; items: Msg[] } | null>(null);
  const [profileModal, setProfileModal] = useState<{ lead: Lead; enrichment: Record<string, unknown> | null } | null>(null);

  const loadLeads = useCallback(async () => {
    const p = new URLSearchParams();
    if (fIndustry) p.set('industry', fIndustry);
    if (fCompany) p.set('company', fCompany);
    if (fTitle) p.set('title', fTitle);
    if (fName) p.set('name', fName);
    const res = await fetch('/api/leads?' + p.toString());
    const data = await res.json();
    setLeads(data.leads ?? []);
  }, [fIndustry, fCompany, fTitle, fName]);

  const loadConnections = useCallback(async () => {
    const res = await fetch('/api/connections');
    const data = await res.json();
    setSyncStatus(data.status ?? 'none');
    setConns(data.connections ?? []);
    return data as { status: string; lastSyncAt: string | null; connections: Staged[] };
  }, []);

  const sync = useCallback(async () => {
    setBusy((p) => ({ ...p, sync: true }));
    const res = await fetch('/api/sync/connections', { method: 'POST' });
    const data = await res.json();
    setBusy((p) => ({ ...p, sync: false }));
    if (res.ok) {
      await loadConnections();
      return true;
    }
    setMsg('Sync failed: ' + (data.error ?? res.status));
    return false;
  }, [loadConnections]);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Auto-fetch connections on open when never synced or stale (>24h).
  // Uses lightweight metadata only — the full (potentially large) connections
  // list is loaded lazily when the user opens "Add from connections".
  useEffect(() => {
    if (autoSynced.current) return;
    autoSynced.current = true;
    (async () => {
      const res = await fetch('/api/connections?meta=1');
      const m = await res.json();
      setSyncStatus(m.status ?? 'none');
      const stale = !m.lastSyncAt || Date.now() - new Date(m.lastSyncAt).getTime() > STALE_MS;
      if ((m.count ?? 0) === 0 || stale) {
        setMsg('Refreshing your connections…');
        await sync();
        setMsg(null);
      }
    })();
  }, [sync]);

  // Load the full connections list only when the panel is opened.
  useEffect(() => {
    if (showConns && conns.length === 0) loadConnections();
  }, [showConns, conns.length, loadConnections]);

  function setLeadBusy(id: string, v: boolean) {
    setBusy((p) => ({ ...p, [id]: v }));
  }

  const filteredConns = useMemo(() => {
    const n = cName.toLowerCase(), co = cCompany.toLowerCase(), ti = cTitle.toLowerCase(), ind = cIndustry.toLowerCase();
    return conns.filter((c) => {
      if (n && !c.fullName.toLowerCase().includes(n)) return false;
      if (co && !(c.company ?? '').toLowerCase().includes(co) && !(c.headline ?? '').toLowerCase().includes(co)) return false;
      if (ti && !(c.title ?? '').toLowerCase().includes(ti) && !(c.headline ?? '').toLowerCase().includes(ti)) return false;
      // Pre-selection has no industry field → match against the headline text.
      if (ind && !(c.headline ?? '').toLowerCase().includes(ind)) return false;
      return true;
    });
  }, [conns, cName, cCompany, cTitle, cIndustry]);

  function toggleConn(url: string) {
    setSelConns((p) => { const n = new Set(p); n.has(url) ? n.delete(url) : n.add(url); return n; });
  }
  function toggleLead(id: string) {
    setSelLeads((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function addSelectedConns() {
    const chosen = filteredConns.filter((c) => selConns.has(c.profileUrl) && !c.alreadyLead);
    if (!chosen.length) return setMsg('Nothing new selected.');
    const res = await fetch('/api/leads/select', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connections: chosen }),
    });
    const data = await res.json();
    if (!res.ok) setMsg('Save failed: ' + (data.error ?? res.status));
    else { setMsg(`Added ${data.inserted} lead(s).`); setSelConns(new Set()); loadConnections(); loadLeads(); }
  }

  async function openCampaignModal() {
    const res = await fetch('/api/campaigns');
    const data = await res.json();
    setCampaigns(data.campaigns ?? []);
    setCampMode((data.campaigns ?? []).length ? 'existing' : 'new');
    setChosenCamp((data.campaigns ?? [])[0]?.id ?? '');
    setNewName(''); setNewCta(''); setNewOffer('');
    setCampModal(true);
  }

  async function addToCampaign() {
    const leadIds = Array.from(selLeads);
    if (!leadIds.length) return;
    let res: Response;
    if (campMode === 'new') {
      res = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), cta: newCta.trim(), offer: newOffer.trim(), leadIds }),
      });
    } else {
      if (!chosenCamp) return setMsg('Pick a campaign.');
      res = await fetch(`/api/campaigns/${chosenCamp}/leads`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadIds }),
      });
    }
    const data = await res.json();
    if (!res.ok) setMsg('Failed: ' + (data.error ?? res.status));
    else {
      setMsg(campMode === 'new' ? `Campaign created with ${leadIds.length} leads.` : `Added ${data.added} lead(s) to campaign.`);
      setCampModal(false); setSelLeads(new Set());
    }
  }

  async function enrich(id: string) {
    setMsg(null); setLeadBusy(id, true);
    const res = await fetch(`/api/leads/${id}/enrich`, { method: 'POST' });
    const data = await res.json();
    setLeadBusy(id, false);
    if (!res.ok) setMsg('Enrich failed: ' + (data.error ?? res.status));
    else { setMsg('Enriched.'); loadLeads(); }
  }
  async function openMessages(lead: Lead) {
    const res = await fetch(`/api/leads/${lead.id}/messages`);
    const data = await res.json();
    setMsgsModal({ lead, items: data.messages ?? [] });
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

  const badge = (s: string | null) =>
    s === 'sent' ? 'good' : s === 'failed' || s === 'rejected' ? 'bad' : s === 'approved' ? 'warn' : 'plain';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Leads</h1>
          <div className="sub">Your 1st-degree connections, enriched and contacted</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={sync} disabled={busy.sync}>
          <IconSync /> {busy.sync ? 'Syncing…' : 'Sync connections'}
        </button>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {/* Add from connections */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>Add from connections {conns.length > 0 && <span className="muted">({conns.length})</span>}</h2>
          <button className="btn ghost sm" onClick={() => setShowConns((v) => !v)}>{showConns ? 'Hide' : 'Show'}</button>
        </div>
        {showConns && (
          <>
            <div className="grid cols-3" style={{ margin: '12px 0', gap: 10 }}>
              <input placeholder="Industry" value={cIndustry} onChange={(e) => setCIndustry(e.target.value)} />
              <input placeholder="Company" value={cCompany} onChange={(e) => setCCompany(e.target.value)} />
              <input placeholder="Title" value={cTitle} onChange={(e) => setCTitle(e.target.value)} />
              <input placeholder="Name" value={cName} onChange={(e) => setCName(e.target.value)} />
            </div>
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="btn" onClick={addSelectedConns} disabled={selConns.size === 0}>Add {selConns.size || ''} to leads</button>
              <span className="muted">{syncStatus === 'none' ? 'No sync yet' : `${filteredConns.length} shown`}</span>
            </div>
            <div className="table-wrap" style={{ maxHeight: 300, overflowY: 'auto' }}>
              <table>
                <thead><tr><th></th><th>Name</th><th>Headline</th></tr></thead>
                <tbody>
                  {filteredConns.slice(0, 200).map((c) => (
                    <tr key={c.profileUrl}>
                      <td style={{ width: 36 }}>
                        {c.alreadyLead ? <span className="badge good plain">✓</span> :
                          <input type="checkbox" style={{ width: 'auto' }} checked={selConns.has(c.profileUrl)} onChange={() => toggleConn(c.profileUrl)} />}
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

      {/* Lead filters */}
      <div className="card">
        <div className="grid cols-3" style={{ gap: 10 }}>
          <input placeholder="Industry" value={fIndustry} onChange={(e) => setFIndustry(e.target.value)} />
          <input placeholder="Company" value={fCompany} onChange={(e) => setFCompany(e.target.value)} />
          <input placeholder="Title" value={fTitle} onChange={(e) => setFTitle(e.target.value)} />
          <input placeholder="Name" value={fName} onChange={(e) => setFName(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn secondary" onClick={loadLeads}>Apply filters</button>
        </div>
      </div>

      {/* Leads table */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{leads.length} lead{leads.length === 1 ? '' : 's'}</h2>
          {selLeads.size > 0 && (
            <button className="btn" onClick={openCampaignModal}>Add {selLeads.size} to campaign</button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th></th><th>Name</th><th>Title / Company</th><th>Industry</th><th>Enriched</th><th>Messages</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td style={{ width: 32 }}><input type="checkbox" style={{ width: 'auto' }} checked={selLeads.has(l.id)} onChange={() => toggleLead(l.id)} /></td>
                  <td><a href={l.profile_url} target="_blank" rel="noreferrer">{leadName(l)}</a></td>
                  <td className="muted">{l.current_title ?? '—'}{l.current_company ? ` · ${l.current_company}` : ''}</td>
                  <td className="muted">{l.industry ?? '—'}</td>
                  <td>{l.enriched_at ? <span className="badge good">yes</span> : <span className="badge plain">no</span>}</td>
                  <td>
                    {l.messageCount > 0 ? (
                      <button className="btn ghost sm" onClick={() => openMessages(l)}>View ({l.messageCount})</button>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn secondary sm" onClick={() => enrich(l.id)} disabled={busy[l.id]}>Enrich</button>
                      {l.enriched_at && <button className="btn secondary sm" onClick={() => openProfile(l)}>Profile</button>}
                      <button className="btn ghost sm" onClick={() => removeLead(l.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && <tr><td colSpan={7} className="muted">No leads yet — add some from your connections above.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add-to-campaign modal */}
      {campModal && (
        <div className="modal-backdrop" onClick={() => setCampModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Add {selLeads.size} lead(s) to a campaign</h2>
              <button className="btn ghost sm" onClick={() => setCampModal(false)}>Close</button>
            </div>
            <div className="seg" style={{ margin: '14px 0' }}>
              <button className={campMode === 'existing' ? 'on' : ''} onClick={() => setCampMode('existing')}>Existing</button>
              <button className={campMode === 'new' ? 'on' : ''} onClick={() => setCampMode('new')}>New campaign</button>
            </div>
            {campMode === 'existing' ? (
              <>
                <label>Campaign</label>
                <select value={chosenCamp} onChange={(e) => setChosenCamp(e.target.value)}>
                  {campaigns.length === 0 && <option value="">No campaigns yet</option>}
                  {campaigns.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>)}
                </select>
              </>
            ) : (
              <>
                <label>Name</label>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Q3 founders outreach" />
                <label>Call to action</label>
                <input value={newCta} onChange={(e) => setNewCta(e.target.value)} placeholder="Book a 15-min intro call" />
                <label>Your offer</label>
                <textarea rows={2} value={newOffer} onChange={(e) => setNewOffer(e.target.value)} />
              </>
            )}
            <button className="btn" style={{ marginTop: 16 }} onClick={addToCampaign}
              disabled={campMode === 'new' ? !newName.trim() : !chosenCamp}>
              {campMode === 'new' ? 'Create & add' : 'Add to campaign'}
            </button>
          </div>
        </div>
      )}

      {/* Messages modal */}
      {msgsModal && (
        <div className="modal-backdrop" onClick={() => setMsgsModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Messages · {leadName(msgsModal.lead)}</h2>
              <button className="btn ghost sm" onClick={() => setMsgsModal(null)}>Close</button>
            </div>
            {msgsModal.items.length === 0 && <p className="muted">No messages yet. Add this lead to a campaign to generate and send messages.</p>}
            {msgsModal.items.map((m) => (
              <div key={m.id} className="card" style={{ boxShadow: 'none', marginTop: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="row" style={{ gap: 8 }}>
                    <span className={`badge ${badge(m.status)}`}>{m.status}</span>
                    {m.campaignName && <span className="badge plain">◆ {m.campaignName}</span>}
                  </span>
                  <span className="muted" style={{ fontSize: 12 }}>{m.sent_at ? `sent ${new Date(m.sent_at).toLocaleString()}` : new Date(m.created_at).toLocaleString()}</span>
                </div>
                <p style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profile modal */}
      {profileModal && (
        <div className="modal-backdrop" onClick={() => setProfileModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{leadName(profileModal.lead)}</h2>
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
        <div key={i} style={{ marginBottom: 6 }}><strong>{e.school ?? 'School'}</strong><div className="muted" style={{ fontSize: 13 }}>{[e.degree, e.field].filter(Boolean).join(', ')}</div></div>
      ))}
      {skills.length > 0 && (<><h2 style={{ marginTop: 16 }}>Skills</h2><div className="row" style={{ gap: 6 }}>{skills.slice(0, 30).map((s, i) => <span key={i} className="badge plain">{s}</span>)}</div></>)}
      {posts.length > 0 && (<><h2 style={{ marginTop: 16 }}>Recent posts</h2>{posts.slice(0, 3).map((p, i) => <p key={i} className="muted" style={{ fontSize: 13 }}>“{(p.text ?? '').slice(0, 200)}”</p>)}</>)}
    </div>
  );
}
