'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
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

function leadName(l: { first_name: string | null; last_name: string | null }) {
  return [l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead';
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

export default function LeadsPage() {
  const confirm = useConfirm();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [msg, setMsg] = useState<string | null>(null);

  // Filters (run on enriched columns)
  const [fIndustry, setFIndustry] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [fTitle, setFTitle] = useState('');
  const [fName, setFName] = useState('');

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

  // Profile drawer
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

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  function toggleLead(id: string) {
    setSelLeads((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
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

  async function openProfile(lead: Lead) {
    const res = await fetch(`/api/leads/${lead.id}`);
    const data = await res.json();
    setProfileModal({ lead, enrichment: data.enrichment });
  }
  function addOneToCampaign(leadId: string) {
    setSelLeads(new Set([leadId]));
    setProfileModal(null);
    openCampaignModal();
  }
  async function removeLead(id: string) {
    if (!(await confirm({ title: 'Delete lead', message: 'Delete this lead?', confirmLabel: 'Delete', danger: true }))) return;
    await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    loadLeads();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Leads</h1>
          <div className="sub">Your saved, enriched connections — filter and add them to campaigns</div>
        </div>
        <div className="spacer" />
        <Link className="btn" href="/connections">Find more leads →</Link>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {/* Filters */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Filter your leads</h2>
          <span className="muted" style={{ fontSize: 12 }}>Filters run on enriched fields.</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ flex: '1 1 150px' }} placeholder="Industry" value={fIndustry} onChange={(e) => setFIndustry(e.target.value)} />
          <input style={{ flex: '1 1 150px' }} placeholder="Company" value={fCompany} onChange={(e) => setFCompany(e.target.value)} />
          <input style={{ flex: '1 1 150px' }} placeholder="Title" value={fTitle} onChange={(e) => setFTitle(e.target.value)} />
          <input style={{ flex: '1 1 150px' }} placeholder="Name" value={fName} onChange={(e) => setFName(e.target.value)} />
          <button className="btn" onClick={loadLeads} style={{ flexShrink: 0 }}>Apply filters</button>
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
              <tr><th style={{ width: 32 }}></th><th>Lead</th><th>Company</th><th>Email</th><th>Enrichment</th></tr>
            </thead>
            <tbody>
              {leads.map((l) => {
                const name = leadName(l);
                return (
                  <tr key={l.id} onClick={() => openProfile(l)} style={{ cursor: 'pointer' }}>
                    <td style={{ width: 32 }} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={selLeads.has(l.id)} onChange={() => toggleLead(l.id)} />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 10, minWidth: 0 }}>
                        <span className="avatar-c" style={{ width: 34, height: 34, fontSize: 12, background: avatarColor(name) }}>{initials(name)}</span>
                        <span style={{ minWidth: 0 }}>
                          <span style={{ display: 'block', fontWeight: 600 }}>{name}</span>
                          <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{l.current_title ?? '—'}</span>
                        </span>
                      </div>
                    </td>
                    <td>
                      <span style={{ display: 'block', fontWeight: 550 }}>{l.current_company ?? '—'}</span>
                      {l.industry && <span className="muted" style={{ display: 'block', fontSize: 12.5 }}>{l.industry}</span>}
                    </td>
                    <td className="muted" style={{ fontSize: 13 }}>
                      {l.email ? (
                        <span className="row" style={{ gap: 6 }}>
                          <span style={{ width: 7, height: 7, borderRadius: 999, background: 'var(--good)', flexShrink: 0 }} />
                          {l.email}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {l.enriched_at
                        ? <span className="badge good">Done</span>
                        : <span className="badge plain">None</span>}
                    </td>
                  </tr>
                );
              })}
              {leads.length === 0 && (
                <tr><td colSpan={5} className="muted">No leads yet — head to <Link href="/connections">Connections</Link> to add matching connections.</td></tr>
              )}
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
                    No offers yet — add them in <Link href="/settings">Settings</Link> to ground your messages.
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

      {/* Profile drawer */}
      {profileModal && (
        <LeadDrawer
          lead={profileModal.lead}
          enrichment={profileModal.enrichment}
          onClose={() => setProfileModal(null)}
          onAddToCampaign={() => addOneToCampaign(profileModal.lead.id)}
          onDelete={async () => { await removeLead(profileModal.lead.id); setProfileModal(null); }}
        />
      )}
    </div>
  );
}

function Field({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <div className="drawer-field">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function LeadDrawer({
  lead,
  enrichment,
  onClose,
  onAddToCampaign,
  onDelete,
}: {
  lead: Lead;
  enrichment: Record<string, unknown> | null;
  onClose: () => void;
  onAddToCampaign: () => void;
  onDelete: () => void;
}) {
  const name = leadName(lead);
  const exp = (enrichment?.experiences as Array<Record<string, string>>) ?? [];
  const edu = (enrichment?.education as Array<Record<string, string>>) ?? [];
  const skills = (enrichment?.skills as string[]) ?? [];
  const posts = (enrichment?.recent_posts as Array<{ text?: string; url?: string }>) ?? [];
  const summary = (enrichment?.summary as string | null) ?? null;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${name} profile`}>
        <div className="drawer-head">
          <span className="avatar-c" style={{ width: 44, height: 44, fontSize: 15, background: avatarColor(name) }}>{initials(name)}</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 700, fontSize: 16, lineHeight: 1.2 }}>{name}</div>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
              {[lead.current_title, lead.current_company].filter(Boolean).join(' · ') || lead.headline || '—'}
            </div>
          </div>
          <button className="btn ghost sm" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="drawer-body">
          {/* Contact chips */}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {lead.email && <a className="chip" href={`mailto:${lead.email}`}>✉ {lead.email}</a>}
            <a className="chip" href={lead.profile_url} target="_blank" rel="noreferrer">in · LinkedIn ↗</a>
          </div>

          {/* Quick facts */}
          <div className="drawer-section-title">General</div>
          <div className="drawer-grid">
            <Field k="Title" v={lead.current_title} />
            <Field k="Company" v={lead.current_company} />
            <Field k="Industry" v={lead.industry} />
            <Field k="Location" v={lead.location} />
            <Field k="Email" v={lead.email} />
            <Field k="Enriched" v={lead.enriched_at ? new Date(lead.enriched_at).toLocaleDateString() : 'Not enriched'} />
          </div>

          {lead.headline && (
            <>
              <div className="drawer-section-title">Headline</div>
              <p className="muted" style={{ fontSize: 13.5, margin: 0 }}>{lead.headline}</p>
            </>
          )}

          {summary && (
            <>
              <div className="drawer-section-title">About</div>
              <p className="muted" style={{ fontSize: 13.5, margin: 0, whiteSpace: 'pre-wrap' }}>{summary}</p>
            </>
          )}

          {exp.length > 0 && (
            <>
              <div className="drawer-section-title">Experience</div>
              {exp.map((e, i) => (
                <div key={i} style={{ marginBottom: 10 }}>
                  <strong style={{ fontSize: 14 }}>{e.title ?? 'Role'}</strong>{e.company ? ` · ${e.company}` : ''}
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {[e.start, e.end].filter(Boolean).join(' – ')}{e.location ? ` · ${e.location}` : ''}
                  </div>
                  {e.description && <div className="muted" style={{ fontSize: 12.5, marginTop: 3, whiteSpace: 'pre-wrap' }}>{e.description}</div>}
                </div>
              ))}
            </>
          )}

          {edu.length > 0 && (
            <>
              <div className="drawer-section-title">Education</div>
              {edu.map((e, i) => (
                <div key={i} style={{ marginBottom: 8 }}>
                  <strong style={{ fontSize: 14 }}>{e.school ?? 'School'}</strong>
                  <div className="muted" style={{ fontSize: 12.5 }}>{[e.degree, e.field].filter(Boolean).join(', ')}{[e.start, e.end].filter(Boolean).length ? ` · ${[e.start, e.end].filter(Boolean).join(' – ')}` : ''}</div>
                </div>
              ))}
            </>
          )}

          {skills.length > 0 && (
            <>
              <div className="drawer-section-title">Skills</div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {skills.slice(0, 40).map((s, i) => <span key={i} className="badge plain">{s}</span>)}
              </div>
            </>
          )}

          {posts.length > 0 && (
            <>
              <div className="drawer-section-title">Recent posts</div>
              {posts.slice(0, 5).map((p, i) => (
                <p key={i} className="muted" style={{ fontSize: 13, marginTop: 0 }}>
                  “{(p.text ?? '').slice(0, 240)}{(p.text ?? '').length > 240 ? '…' : ''}”
                  {p.url && <> · <a href={p.url} target="_blank" rel="noreferrer">view</a></>}
                </p>
              ))}
            </>
          )}

          {!enrichment && <p className="muted" style={{ fontSize: 13, marginTop: 18 }}>Not enriched yet — no deep profile data available.</p>}
        </div>

        <div className="drawer-foot row" style={{ gap: 8 }}>
          <button className="btn ghost" onClick={onDelete}>Delete</button>
          <button className="btn" style={{ flex: 1 }} onClick={onAddToCampaign}>Add to Campaign →</button>
        </div>
      </aside>
    </>
  );
}
