'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { IconSync } from '@/app/components/icons';
import { useConfirm } from '@/app/components/ConfirmDialog';

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
  email: string | null;
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
interface Offer {
  id: string;
  name: string;
  description: string | null;
}

const STALE_MS = 24 * 60 * 60 * 1000;
function leadName(l: { first_name: string | null; last_name: string | null }) {
  return [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead';
}
// ICP keyword match: connections only carry a free-text headline pre-enrichment,
// so every ICP term is matched against the headline (+ name for the name field).
function matchTerm(haystack: string, term: string) {
  return !term || haystack.toLowerCase().includes(term.toLowerCase());
}

export default function LeadsPage() {
  const confirm = useConfirm();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  // Lead (post-enrichment) filters — these hit real columns.
  const [fIndustry, setFIndustry] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [fTitle, setFTitle] = useState('');
  const [fName, setFName] = useState('');

  // ICP (pre-selection, headline keyword match)
  const [conns, setConns] = useState<Staged[]>([]);
  const [connsLoaded, setConnsLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('none');
  const [icpIndustry, setIcpIndustry] = useState('');
  const [icpTitle, setIcpTitle] = useState('');
  const [icpCompany, setIcpCompany] = useState('');
  const [icpName, setIcpName] = useState('');
  const [icpApplied, setIcpApplied] = useState(false);
  const [selConns, setSelConns] = useState<Set<string>>(new Set());
  const autoSynced = useRef(false);

  // Lead multi-select → campaign
  const [selLeads, setSelLeads] = useState<Set<string>>(new Set());
  const [campModal, setCampModal] = useState(false);
  const [campaigns, setCampaigns] = useState<CampaignOpt[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [campMode, setCampMode] = useState<'existing' | 'new'>('existing');
  const [chosenCamp, setChosenCamp] = useState('');
  const [newName, setNewName] = useState('');
  const [newCta, setNewCta] = useState('');
  const [chosenOffer, setChosenOffer] = useState('');

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
    setConnsLoaded(true);
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
      } else {
        loadConnections();
      }
    })();
  }, [sync, loadConnections]);

  function setLeadBusy(id: string, v: boolean) {
    setBusy((p) => ({ ...p, [id]: v }));
  }

  // ICP result: AND across the provided terms, all matched on the headline
  // (name also checks the full name).
  const icpResults = useMemo(() => {
    return conns.filter((c) => {
      const headline = c.headline ?? '';
      if (!matchTerm(headline, icpIndustry)) return false;
      if (!matchTerm(headline + ' ' + (c.title ?? ''), icpTitle)) return false;
      if (!matchTerm(headline + ' ' + (c.company ?? ''), icpCompany)) return false;
      if (!matchTerm(c.fullName, icpName)) return false;
      return true;
    });
  }, [conns, icpIndustry, icpTitle, icpCompany, icpName]);

  const hasIcp = !!(icpIndustry || icpTitle || icpCompany || icpName);

  function applyIcp() {
    setIcpApplied(true);
    setSelConns(new Set());
  }
  function resetIcp() {
    setIcpIndustry(''); setIcpTitle(''); setIcpCompany(''); setIcpName('');
    setIcpApplied(false); setSelConns(new Set());
  }
  function toggleConn(url: string) {
    setSelConns((p) => { const n = new Set(p); n.has(url) ? n.delete(url) : n.add(url); return n; });
  }
  const eligibleUrls = useMemo(
    () => icpResults.filter((c) => !c.alreadyLead).map((c) => c.profileUrl),
    [icpResults]
  );
  const allSelected = eligibleUrls.length > 0 && eligibleUrls.every((u) => selConns.has(u));

  function toggleSelectAll() {
    setSelConns(allSelected ? new Set() : new Set(eligibleUrls));
  }
  function toggleLead(id: string) {
    setSelLeads((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function addSelectedConns() {
    const chosen = icpResults.filter((c) => selConns.has(c.profileUrl) && !c.alreadyLead);
    if (!chosen.length) return setMsg('Nothing new selected.');
    setBusy((p) => ({ ...p, addConns: true }));
    setMsg(`Adding ${chosen.length} lead(s) and enriching…`);
    const res = await fetch('/api/leads/select', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connections: chosen }),
    });
    const data = await res.json();
    setBusy((p) => ({ ...p, addConns: false }));
    if (!res.ok) setMsg('Save failed: ' + (data.error ?? res.status));
    else {
      setMsg(`Added ${data.inserted} lead(s)${typeof data.enriched === 'number' ? ` · enriched ${data.enriched}` : ''}.`);
      setSelConns(new Set());
      loadConnections();
      loadLeads();
    }
  }

  async function openCampaignModal() {
    const [cRes, oRes] = await Promise.all([fetch('/api/campaigns'), fetch('/api/offers')]);
    const cData = await cRes.json();
    const oData = await oRes.json();
    const camps = cData.campaigns ?? [];
    const offs: Offer[] = oData.offers ?? [];
    setCampaigns(camps);
    setOffers(offs);
    setCampMode(camps.length ? 'existing' : 'new');
    setChosenCamp(camps[0]?.id ?? '');
    setChosenOffer(offs[0]?.id ?? '');
    setNewName(''); setNewCta('');
    setCampModal(true);
  }

  async function addToCampaign() {
    const leadIds = Array.from(selLeads);
    if (!leadIds.length) return;
    let res: Response;
    if (campMode === 'new') {
      res = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), cta: newCta.trim(), offerId: chosenOffer || undefined, leadIds }),
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
    if (!(await confirm({ title: 'Delete lead', message: 'Delete this lead?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    loadLeads();
  }

  const badge = (s: string | null) =>
    s === 'sent' ? 'good' : s === 'failed' || s === 'rejected' ? 'bad' : s === 'approved' ? 'warn' : 'plain';

  const eligibleCount = icpResults.filter((c) => !c.alreadyLead).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Leads</h1>
          <div className="sub">Define your ICP, pull matching connections, enrich &amp; contact</div>
        </div>
        <div className="spacer" />
        <button className="btn ghost" onClick={sync} disabled={busy.sync}>
          <IconSync /> {busy.sync ? 'Syncing…' : 'Re-sync'}
        </button>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {/* ICP form */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Your ideal customer profile</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Describe who you want to reach. Terms are matched against each connection&apos;s LinkedIn
          headline. {syncStatus === 'none' ? 'No connections synced yet — hit Re-sync.' : `${conns.length} connections available.`}
        </p>
        <div className="grid cols-3" style={{ gap: 10 }}>
          <div>
            <label>Industry</label>
            <input placeholder="e.g. SaaS, fintech" value={icpIndustry} onChange={(e) => setIcpIndustry(e.target.value)} />
          </div>
          <div>
            <label>Title / role</label>
            <input placeholder="e.g. founder, head of sales" value={icpTitle} onChange={(e) => setIcpTitle(e.target.value)} />
          </div>
          <div>
            <label>Company</label>
            <input placeholder="e.g. Stripe" value={icpCompany} onChange={(e) => setIcpCompany(e.target.value)} />
          </div>
          <div>
            <label>Name</label>
            <input placeholder="Search by name" value={icpName} onChange={(e) => setIcpName(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn" onClick={applyIcp} disabled={!connsLoaded}>Show matching connections</button>
          {icpApplied && <button className="btn ghost" onClick={resetIcp}>Reset</button>}
          {icpApplied && (
            <span className="muted">{icpResults.length} match{icpResults.length === 1 ? '' : 'es'} · {eligibleCount} new</span>
          )}
        </div>
      </div>

      {/* ICP results */}
      {icpApplied && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Matching connections</h2>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost sm" onClick={toggleSelectAll} disabled={eligibleCount === 0}>{allSelected ? 'Deselect all' : 'Select all new'}</button>
              <button className="btn" onClick={addSelectedConns} disabled={selConns.size === 0 || busy.addConns}>
                {busy.addConns ? 'Adding…' : `Add ${selConns.size || ''} to leads`}
              </button>
            </div>
          </div>
          {!hasIcp && <p className="muted" style={{ fontSize: 13 }}>No ICP terms set — showing all connections.</p>}
          <div className="table-wrap" style={{ maxHeight: 340, overflowY: 'auto', marginTop: 10 }}>
            <table>
              <thead><tr><th></th><th>Name</th><th>Headline</th></tr></thead>
              <tbody>
                {icpResults.slice(0, 300).map((c) => (
                  <tr key={c.profileUrl}>
                    <td style={{ width: 36 }}>
                      {c.alreadyLead ? <span className="badge good">✓</span> :
                        <input type="checkbox" style={{ width: 'auto' }} checked={selConns.has(c.profileUrl)} onChange={() => toggleConn(c.profileUrl)} />}
                    </td>
                    <td><a href={c.profileUrl} target="_blank" rel="noreferrer">{c.fullName}</a></td>
                    <td className="muted">{c.headline ?? '—'}</td>
                  </tr>
                ))}
                {icpResults.length === 0 && <tr><td colSpan={3} className="muted">No connections match this ICP.</td></tr>}
              </tbody>
            </table>
          </div>
          {icpResults.length > 300 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Showing first 300 of {icpResults.length}. Narrow your ICP to see the rest.</p>}
        </div>
      )}

      {/* Lead filters */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Filter your leads</h2>
          <span className="muted" style={{ fontSize: 12 }}>Filters run on enriched fields.</span>
        </div>
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
              <tr><th></th><th>Name</th><th>Title / Company</th><th>Industry</th><th>Email</th><th>Messages</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td style={{ width: 32 }}><input type="checkbox" style={{ width: 'auto' }} checked={selLeads.has(l.id)} onChange={() => toggleLead(l.id)} /></td>
                  <td>
                    <a href={l.profile_url} target="_blank" rel="noreferrer">{leadName(l)}</a>
                    {!l.enriched_at && <span className="badge plain" style={{ marginLeft: 6, fontSize: 10 }}>not enriched</span>}
                  </td>
                  <td className="muted">{l.current_title ?? '—'}{l.current_company ? ` · ${l.current_company}` : ''}</td>
                  <td className="muted">{l.industry ?? '—'}</td>
                  <td className="muted" style={{ fontSize: 13 }}>
                    {l.email ? <a href={`mailto:${l.email}`}>{l.email}</a> : '—'}
                  </td>
                  <td>
                    {l.messageCount > 0 ? (
                      <button className="btn ghost sm" onClick={() => openMessages(l)}>View ({l.messageCount})</button>
                    ) : <span className="muted">—</span>}
                  </td>
                  <td>
                    <div className="row" style={{ gap: 6 }}>
                      <button className="btn secondary sm" onClick={() => enrich(l.id)} disabled={busy[l.id]}>{busy[l.id] ? '…' : 'Enrich'}</button>
                      {l.enriched_at && <button className="btn secondary sm" onClick={() => openProfile(l)}>Profile</button>}
                      <button className="btn ghost sm" onClick={() => removeLead(l.id)}>✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {leads.length === 0 && <tr><td colSpan={7} className="muted">No leads yet — define your ICP above and add matching connections.</td></tr>}
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
                <label>Offer</label>
                {offers.length === 0 ? (
                  <p className="muted" style={{ fontSize: 13 }}>
                    No offers yet — add them in <a href="/settings">Settings</a> to ground your messages.
                  </p>
                ) : (
                  <select value={chosenOffer} onChange={(e) => setChosenOffer(e.target.value)}>
                    {offers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
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
                    {m.campaignName && <span className="badge plain">{m.campaignName}</span>}
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
            <ProfileDetail enrichment={profileModal.enrichment} email={profileModal.lead.email} />
          </div>
        </div>
      )}
    </div>
  );
}

function ProfileDetail({ enrichment, email }: { enrichment: Record<string, unknown> | null; email: string | null }) {
  if (!enrichment) return <p className="muted">Not enriched yet.</p>;
  const exp = (enrichment.experiences as Array<Record<string, string>>) ?? [];
  const edu = (enrichment.education as Array<Record<string, string>>) ?? [];
  const skills = (enrichment.skills as string[]) ?? [];
  const posts = (enrichment.recent_posts as Array<{ text?: string }>) ?? [];
  const summary = enrichment.summary as string | null;
  return (
    <div style={{ marginTop: 10 }}>
      {email && <p style={{ margin: '0 0 8px' }}><strong>Email:</strong> <a href={`mailto:${email}`}>{email}</a></p>}
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
