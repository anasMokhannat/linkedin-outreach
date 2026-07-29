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
  known: boolean;
  enriched_at: string | null;
  messageStatus: string | null;
  messageBody: string | null;
}

interface LeadMessage {
  id: string;
  body: string;
  status: string;
  model: string | null;
  created_at: string;
  sent_at: string | null;
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

  // Selection + send flow
  const [selLeads, setSelLeads] = useState<Set<string>>(new Set());
  const [busyGen, setBusyGen] = useState(false);
  const [preview, setPreview] = useState<Lead[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Set<string>>(new Set());

  // Profile drawer
  const [profileModal, setProfileModal] = useState<{ lead: Lead; enrichment: Record<string, unknown> | null; messages: LeadMessage[] } | null>(null);

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
  const allSelected = leads.length > 0 && leads.every((l) => selLeads.has(l.id));
  function toggleSelectAll() {
    setSelLeads(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  }

  async function generate(idsArg?: string[]) {
    const ids = idsArg ?? Array.from(selLeads);
    if (!ids.length) return;
    setBusyGen(true);
    setMsg(null);
    const res = await fetch('/api/leads/generate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadIds: ids }),
    });
    const data = await res.json();
    setBusyGen(false);
    if (!res.ok) { setMsg('Generate failed: ' + (data.error ?? res.status)); return; }
    const byId: Record<string, string> = {};
    (data.drafts as Array<{ leadId: string; body: string }>).forEach((d) => { byId[d.leadId] = d.body; });
    setDrafts(byId);
    setSent(new Set());
    setPreview(ids.map((id) => leads.find((l) => l.id === id)).filter((l): l is Lead => !!l));
  }

  async function sendOne(id: string): Promise<boolean> {
    const body = (drafts[id] ?? '').trim();
    if (!body) return false;
    setSending((s) => new Set(s).add(id));
    const res = await fetch(`/api/leads/${id}/send`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const data = await res.json();
    setSending((s) => { const n = new Set(s); n.delete(id); return n; });
    if (!res.ok) { setMsg((data.error ?? `Send failed (${res.status})`)); return false; }
    setSent((s) => new Set(s).add(id));
    return true;
  }
  async function sendAll() {
    for (const l of preview ?? []) {
      if (sent.has(l.id)) continue;
      const ok = await sendOne(l.id);
      if (!ok) break; // stop on failure (e.g. daily limit reached)
    }
  }
  function closePreview() {
    setPreview(null);
    setSelLeads(new Set());
    loadLeads();
  }

  async function openProfile(lead: Lead) {
    const res = await fetch(`/api/leads/${lead.id}`);
    const data = await res.json();
    setProfileModal({ lead, enrichment: data.enrichment, messages: data.messages ?? [] });
  }
  async function removeLead(id: string) {
    if (!(await confirm({ title: 'Delete lead', message: 'Delete this lead?', confirmLabel: 'Delete', danger: true }))) return;
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    if (!res.ok) { setMsg('Delete failed.'); return; }
    // Drop any generated-message UI state for this lead so it can't stay visible.
    setDrafts((d) => { const n = { ...d }; delete n[id]; return n; });
    setSent((s) => { const n = new Set(s); n.delete(id); return n; });
    setPreview((p) => {
      if (!p) return p;
      const next = p.filter((l) => l.id !== id);
      return next.length ? next : null;
    });
    loadLeads();
  }
  async function setKnown(id: string, known: boolean) {
    setLeads((p) => p.map((l) => (l.id === id ? { ...l, known } : l))); // optimistic
    setProfileModal((m) => (m && m.lead.id === id ? { ...m, lead: { ...m.lead, known } } : m));
    await fetch(`/api/leads/${id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ known }),
    });
  }

  const statusBadge = (s: string | null) =>
    s === 'sent' ? <span className="badge good" style={{ fontSize: 10 }}>sent</span>
      : s === 'draft' ? <span className="badge warn" style={{ fontSize: 10 }}>draft</span>
      : null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Leads</h1>
          <div className="sub">Generate a personalized message and send it — one lead or many</div>
        </div>
        <div className="spacer" />
        <Link className="btn secondary" href="/connections">Find more leads</Link>
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
            <button className="btn" onClick={() => generate()} disabled={busyGen}>
              {busyGen ? 'Generating…' : `Generate ${selLeads.size} message${selLeads.size === 1 ? '' : 's'}`}
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input type="checkbox" style={{ width: 'auto' }} checked={allSelected} onChange={toggleSelectAll} aria-label="Select all" />
                </th>
                <th>Lead</th><th>Company</th><th>Email</th><th>Known</th><th style={{ width: 44 }} aria-label="Actions" />
              </tr>
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
                          <span className="row" style={{ gap: 6 }}><span style={{ fontWeight: 600 }}>{name}</span>{statusBadge(l.messageStatus)}</span>
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
                    <td onClick={(e) => e.stopPropagation()}>
                      <label className="switch" title={l.known ? 'You know this lead' : "You don't know this lead"}>
                        <input type="checkbox" checked={l.known} onChange={(e) => setKnown(l.id, e.target.checked)} />
                        <span className="track" /><span className="thumb" />
                      </label>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn ghost sm" title="Remove lead" aria-label="Remove lead" onClick={() => removeLead(l.id)}>✕</button>
                    </td>
                  </tr>
                );
              })}
              {leads.length === 0 && (
                <tr><td colSpan={6} className="muted">No leads yet — head to <Link href="/connections">Connections</Link> to add matching connections.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate → preview → send panel */}
      {preview && (
        <div className="modal-backdrop" onClick={closePreview}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Review &amp; send ({preview.length})</h2>
              <button className="btn ghost sm" onClick={closePreview}>Close</button>
            </div>
            <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Edit each message if you like, then send. Sends respect your daily limit.</p>

            <div style={{ maxHeight: '60vh', overflowY: 'auto', marginTop: 8 }}>
              {preview.map((l) => {
                const name = leadName(l);
                const isSent = sent.has(l.id);
                const isSending = sending.has(l.id);
                const body = drafts[l.id] ?? '';
                return (
                  <div key={l.id} className="card" style={{ boxShadow: 'none', marginTop: 10, marginBottom: 0, background: 'var(--surface-2)' }}>
                    <div className="row" style={{ justifyContent: 'space-between', gap: 10 }}>
                      <span className="row" style={{ gap: 8, minWidth: 0 }}>
                        <span className="avatar-c" style={{ width: 28, height: 28, fontSize: 11, background: avatarColor(name) }}>{initials(name)}</span>
                        <span style={{ fontWeight: 600 }}>{name}</span>
                        {isSent && <span className="badge good">sent</span>}
                      </span>
                      {!isSent && (
                        <button className="btn sm" onClick={() => sendOne(l.id)} disabled={isSending || !body.trim()}>
                          {isSending ? 'Sending…' : 'Send'}
                        </button>
                      )}
                    </div>
                    {body ? (
                      <textarea
                        rows={6}
                        value={body}
                        disabled={isSent}
                        onChange={(e) => setDrafts((d) => ({ ...d, [l.id]: e.target.value }))}
                        style={{ marginTop: 8 }}
                      />
                    ) : (
                      <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>Generation failed for this lead. Close and try again.</p>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
              <button className="btn" onClick={sendAll} disabled={preview.every((l) => sent.has(l.id)) || sending.size > 0}>
                Send all
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Profile drawer */}
      {profileModal && (
        <LeadDrawer
          lead={profileModal.lead}
          enrichment={profileModal.enrichment}
          messages={profileModal.messages}
          onClose={() => setProfileModal(null)}
          onGenerate={() => { const id = profileModal.lead.id; setProfileModal(null); setSelLeads(new Set([id])); generate([id]); }}
          onDelete={async () => { await removeLead(profileModal.lead.id); setProfileModal(null); }}
          onSetKnown={(v) => setKnown(profileModal.lead.id, v)}
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
  messages,
  onClose,
  onGenerate,
  onDelete,
  onSetKnown,
}: {
  lead: Lead;
  enrichment: Record<string, unknown> | null;
  messages: LeadMessage[];
  onClose: () => void;
  onGenerate: () => void;
  onDelete: () => void;
  onSetKnown: (v: boolean) => void;
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

          {/* Relationship toggle — drives AI message tone */}
          <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 16, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--r-ctl)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5 }}>I already know this lead</div>
              <div className="muted" style={{ fontSize: 12 }}>{lead.known ? 'Messages use a warmer, familiar tone.' : 'Messages use a more formal, professional tone.'}</div>
            </div>
            <label className="switch" style={{ flexShrink: 0 }}>
              <input type="checkbox" checked={lead.known} onChange={(e) => onSetKnown(e.target.checked)} />
              <span className="track" /><span className="thumb" />
            </label>
          </div>

          {/* Generated messages — AI drafts and sent messages for this lead */}
          <div className="drawer-section-title">Generated messages</div>
          {messages.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: 0 }}>None yet — use “Generate message” below to create one.</p>
          ) : (
            messages.map((m) => {
              const sent = m.status === 'sent';
              const ts = sent ? m.sent_at ?? m.created_at : m.created_at;
              return (
                <div key={m.id} style={{ marginBottom: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 'var(--r-ctl)' }}>
                  <div className="row" style={{ justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                    <span className={`badge ${sent ? 'good' : 'warn'}`}>{sent ? 'Sent' : 'Not sent yet'}</span>
                    {ts && <span className="muted" style={{ fontSize: 12 }}>{new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>}
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.5 }}>{m.body}</div>
                </div>
              );
            })
          )}

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
        </div>

        <div className="drawer-foot row" style={{ gap: 8 }}>
          <button className="btn ghost" onClick={onDelete}>Delete</button>
          <button
            className="btn"
            style={{ flex: 1 }}
            onClick={onGenerate}
            disabled={messages.length > 0}
            title={messages.length > 0 ? 'A message was already generated for this lead — edit it in Messages' : undefined}
          >
            {messages.length > 0 ? 'Message already generated' : 'Generate message →'}
          </button>
        </div>
      </aside>
    </>
  );
}
