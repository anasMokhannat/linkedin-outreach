'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { fetchJson } from '@/lib/fetch-json';

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
  enrich_status: string | null;
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

const LEADS_PAGE_SIZE = 25;
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
  const [loadingLeads, setLoadingLeads] = useState(true);
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  // Progressive enrichment (runs on open until all leads are enriched).
  const [enriching, setEnriching] = useState(false);
  const [enrichDone, setEnrichDone] = useState(0);
  const [enrichTotal, setEnrichTotal] = useState(0);
  const enrichStarted = useRef(false);

  // Filters (run on enriched columns)
  const [fIndustry, setFIndustry] = useState('');
  const [fCompany, setFCompany] = useState('');
  const [fTitle, setFTitle] = useState('');
  const [fName, setFName] = useState('');
  // Message-status filter (client-side, instant): all | none | draft | sent.
  const [fStatus, setFStatus] = useState<'all' | 'none' | 'draft' | 'sent'>('all');
  const [page, setPage] = useState(1);

  // Selection + send flow
  const [selLeads, setSelLeads] = useState<Set<string>>(new Set());
  const [busyGen, setBusyGen] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);
  const [genTotal, setGenTotal] = useState(0);
  const [genDone, setGenDone] = useState(0);
  const [langModal, setLangModal] = useState<{ ids: string[] } | null>(null);
  const [genLang, setGenLang] = useState('auto');
  const [preview, setPreview] = useState<Lead[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState<Set<string>>(new Set());

  // Profile drawer
  const [profileModal, setProfileModal] = useState<{ lead: Lead; enrichment: Record<string, unknown> | null; messages: LeadMessage[] } | null>(null);

  // Filters are read from a ref so loadLeads has a stable identity (no refetch
  // on every keystroke) and only runs on mount / Apply / Enter.
  const filtersRef = useRef({ fIndustry, fCompany, fTitle, fName });
  filtersRef.current = { fIndustry, fCompany, fTitle, fName };
  const loadAbortRef = useRef<AbortController | null>(null);

  const loadLeads = useCallback(async () => {
    const { fIndustry, fCompany, fTitle, fName } = filtersRef.current;
    const p = new URLSearchParams();
    p.set('enriched', 'true'); // the Leads page only shows enriched leads
    if (fIndustry) p.set('industry', fIndustry);
    if (fCompany) p.set('company', fCompany);
    if (fTitle) p.set('title', fTitle);
    if (fName) p.set('name', fName);
    // Cancel any in-flight request so a slow older response can't overwrite a newer one.
    loadAbortRef.current?.abort();
    const ac = new AbortController();
    loadAbortRef.current = ac;
    setLoadingLeads(true);
    try {
      const data = await fetchJson<{ leads?: Lead[] }>('/api/leads?' + p.toString(), { signal: ac.signal });
      setLeads(data.leads ?? []);
    } catch (e) {
      if ((e as { name?: string })?.name === 'AbortError') return; // superseded — keep loading for the newer request
      setMsg({ text: 'Could not load leads: ' + (e instanceof Error ? e.message : 'error'), error: true });
    } finally {
      if (loadAbortRef.current === ac) setLoadingLeads(false);
    }
  }, []);

  useEffect(() => {
    loadLeads();
  }, [loadLeads]);

  // Enrich not-yet-enriched leads progressively: call the endpoint in a loop,
  // reveal newly-enriched leads after each batch, and drive the progress bar.
  const runEnrich = useCallback(async () => {
    let baseline: number | null = null;
    let prevRemaining = Infinity;
    try {
      for (;;) {
        const data = await fetchJson<{ enriched: number; remaining: number; connected?: boolean; authError?: boolean }>(
          '/api/leads/enrich',
          { method: 'POST' }
        );
        if (!data.connected) return; // not connected → nothing to enrich here
        if (baseline === null) {
          baseline = data.remaining + data.enriched;
          if (baseline === 0) return; // everything already enriched
          setEnrichTotal(baseline);
          setEnriching(true);
        }
        setEnrichDone(Math.max(0, baseline - data.remaining));
        await loadLeads(); // reveal the ones just enriched
        if (data.authError || data.remaining === 0) break;
        // No progress this round (nothing got enriched) → stop; never loop forever.
        if (data.remaining >= prevRemaining) break;
        prevRemaining = data.remaining;
        // Pace between batches — retrieving profiles too fast makes LinkedIn
        // throttle the experience section (leads come back without company).
        await new Promise((r) => setTimeout(r, 1200));
      }
    } catch {
      /* stop silently — revisiting the page resumes enrichment */
    } finally {
      setEnriching(false);
    }
  }, [loadLeads]);

  useEffect(() => {
    if (enrichStarted.current) return;
    enrichStarted.current = true;
    runEnrich();
  }, [runEnrich]);

  function toggleLead(id: string) {
    setSelLeads((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  // Apply the message-status filter on top of the (server-filtered) leads.
  const visibleLeads = useMemo(() => {
    if (fStatus === 'all') return leads;
    if (fStatus === 'none') return leads.filter((l) => !l.messageStatus);
    if (fStatus === 'sent') return leads.filter((l) => l.messageStatus === 'sent');
    return leads.filter((l) => l.messageStatus === 'draft'); // generated, not sent
  }, [leads, fStatus]);

  // "Select all" spans ALL pages (the whole filtered set), not just the page.
  const allSelected = visibleLeads.length > 0 && visibleLeads.every((l) => selLeads.has(l.id));
  function toggleSelectAll() {
    setSelLeads(allSelected ? new Set() : new Set(visibleLeads.map((l) => l.id)));
  }

  // Client-side pagination over the filtered set.
  const pageCount = Math.max(1, Math.ceil(visibleLeads.length / LEADS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageLeads = visibleLeads.slice((safePage - 1) * LEADS_PAGE_SIZE, safePage * LEADS_PAGE_SIZE);
  const pageAllSelected = pageLeads.length > 0 && pageLeads.every((l) => selLeads.has(l.id));
  function togglePage() {
    setSelLeads((prev) => {
      const n = new Set(prev);
      if (pageAllSelected) pageLeads.forEach((l) => n.delete(l.id));
      else pageLeads.forEach((l) => n.add(l.id));
      return n;
    });
  }
  // Back to page 1 whenever the status filter changes.
  useEffect(() => { setPage(1); }, [fStatus]);

  // Open the language picker for a batch of lead ids; generation runs on confirm.
  function openLangModal(ids: string[]) {
    if (!ids.length) return;
    setGenLang('auto');
    setLangModal({ ids });
  }
  function confirmGenerate() {
    if (!langModal) return;
    const ids = langModal.ids;
    const language = genLang;
    setLangModal(null);
    setSelLeads(new Set(ids));
    generate(ids, language);
  }

  async function generate(idsArg?: string[], language = 'auto') {
    const ids = idsArg ?? Array.from(selLeads);
    if (!ids.length) return;
    // Split eligibility client-side (known contacts skip enrichment; new leads must be full).
    const selectedLeads = ids.map((id) => leads.find((l) => l.id === id)).filter((l): l is Lead => !!l);
    const eligible = selectedLeads.filter((l) => l.known || l.enrich_status === 'full');
    const skipped = selectedLeads.length - eligible.length;
    setMsg(null);
    setDrafts({});
    setSent(new Set());
    setSkippedCount(skipped);
    if (eligible.length === 0) {
      setMsg({ text: `All ${skipped} selected lead(s) skipped — not enriched yet (only known contacts can be generated without enrichment).`, error: true });
      return;
    }
    // Open the popup immediately; fill it (and the progress bar) as each message arrives.
    setPreview([]);
    setGenTotal(eligible.length);
    setGenDone(0);
    setBusyGen(true);
    for (const lead of eligible) {
      try {
        const data = await fetchJson<{ drafts: Array<{ leadId: string; body: string }> }>('/api/leads/generate', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ leadIds: [lead.id], language }),
        });
        const body = data.drafts.find((d) => d.leadId === lead.id)?.body ?? '';
        if (body) {
          setDrafts((prev) => ({ ...prev, [lead.id]: body }));
          // Append to the popup only if it's still open (don't reopen a closed one).
          setPreview((prev) => (prev ? [...prev, lead] : prev));
        }
      } catch {
        /* skip this lead on error, keep going */
      }
      setGenDone((d) => d + 1);
    }
    setBusyGen(false);
    loadLeads(); // refresh statuses once the whole batch is done
  }

  async function sendOne(id: string): Promise<boolean> {
    const body = (drafts[id] ?? '').trim();
    if (!body) return false;
    setSending((s) => new Set(s).add(id));
    try {
      await fetchJson(`/api/leads/${id}/send`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ body }),
      });
      setSent((s) => new Set(s).add(id));
      return true;
    } catch (e) {
      setMsg({ text: e instanceof Error ? e.message : 'Send failed.', error: true });
      return false;
    } finally {
      setSending((s) => { const n = new Set(s); n.delete(id); return n; });
    }
  }
  async function sendAll() {
    for (const l of preview ?? []) {
      if (sent.has(l.id)) continue;
      const ok = await sendOne(l.id);
      if (!ok) break; // stop on failure (e.g. daily limit reached)
    }
  }
  function closePreview() {
    // Just hide the popup — generation keeps running in the background (drafts are
    // saved as they go and show up in Messages). Progress state is left intact so
    // the background indicator can keep showing until it finishes.
    setPreview(null);
    setSelLeads(new Set());
    setSkippedCount(0);
    loadLeads();
  }

  async function openProfile(lead: Lead) {
    try {
      const data = await fetchJson<{ enrichment: Record<string, unknown> | null; messages?: LeadMessage[] }>(`/api/leads/${lead.id}`);
      setProfileModal({ lead, enrichment: data.enrichment, messages: data.messages ?? [] });
    } catch {
      // Still open the drawer with the basic info we already have.
      setProfileModal({ lead, enrichment: null, messages: [] });
    }
  }
  async function removeLead(id: string) {
    if (!(await confirm({ title: 'Delete lead', message: 'Delete this lead?', confirmLabel: 'Delete', danger: true }))) return;
    const res = await fetch(`/api/leads/${id}`, { method: 'DELETE' });
    if (!res.ok) { setMsg({ text: 'Delete failed.', error: true }); return; }
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
  async function removeSelected() {
    const ids = Array.from(selLeads);
    if (!ids.length) return;
    if (!(await confirm({ title: 'Delete leads', message: `Delete ${ids.length} lead${ids.length === 1 ? '' : 's'}?`, confirmLabel: 'Delete', danger: true }))) return;
    try {
      await fetchJson('/api/leads/delete', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ leadIds: ids }),
      });
    } catch (e) {
      setMsg({ text: 'Delete failed: ' + (e instanceof Error ? e.message : 'error'), error: true });
      return;
    }
    // Drop any generated-message UI state for the removed leads.
    setDrafts((d) => { const n = { ...d }; ids.forEach((id) => delete n[id]); return n; });
    setSent((s) => { const n = new Set(s); ids.forEach((id) => n.delete(id)); return n; });
    setPreview((p) => { if (!p) return p; const next = p.filter((l) => !ids.includes(l.id)); return next.length ? next : null; });
    setSelLeads(new Set());
    loadLeads();
  }

  async function setKnown(id: string, known: boolean) {
    setLeads((p) => p.map((l) => (l.id === id ? { ...l, known } : l))); // optimistic
    setProfileModal((m) => (m && m.lead.id === id ? { ...m, lead: { ...m.lead, known } } : m));
    try {
      await fetchJson(`/api/leads/${id}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ known }),
      });
    } catch {
      // Revert the optimistic toggle if the save failed.
      setLeads((p) => p.map((l) => (l.id === id ? { ...l, known: !known } : l)));
      setProfileModal((m) => (m && m.lead.id === id ? { ...m, lead: { ...m.lead, known: !known } } : m));
      setMsg({ text: 'Could not update — please try again.', error: true });
    }
  }

  const statusBadge = (s: string | null) =>
    s === 'sent' ? <span className="badge good" style={{ fontSize: 10 }}>sent</span>
      : s === 'draft' ? <span className="badge info" style={{ fontSize: 10 }}>draft</span>
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

      {msg && <div className={`notice ${msg.error ? 'bad' : ''}`}>{msg.text}</div>}

      {busyGen && !preview && (
        <div className="notice" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, flexShrink: 0 }}>Generating messages in the background… {genDone}/{genTotal}</span>
          <span style={{ flex: 1, height: 6, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
            <span style={{ display: 'block', width: `${genTotal > 0 ? Math.min(100, (genDone / genTotal) * 100) : 0}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))', transition: 'width .3s' }} />
          </span>
        </div>
      )}

      {enriching && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', fontSize: 13, marginBottom: 6 }}>
            <span className="muted">Enriching leads… {enrichDone}/{enrichTotal}</span>
            <span className="muted">{enrichTotal > 0 ? Math.round((enrichDone / enrichTotal) * 100) : 0}%</span>
          </div>
          <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
            <div style={{ width: `${enrichTotal > 0 ? Math.min(100, (enrichDone / enrichTotal) * 100) : 0}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))', transition: 'width .3s' }} />
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Filter your leads</h2>
          <span className="muted" style={{ fontSize: 12 }}>Filters run on enriched fields.</span>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input style={{ flex: '1 1 150px' }} placeholder="Industry" value={fIndustry} onChange={(e) => setFIndustry(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadLeads(); }} />
          <input style={{ flex: '1 1 150px' }} placeholder="Company" value={fCompany} onChange={(e) => setFCompany(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadLeads(); }} />
          <input style={{ flex: '1 1 150px' }} placeholder="Title" value={fTitle} onChange={(e) => setFTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadLeads(); }} />
          <input style={{ flex: '1 1 150px' }} placeholder="Name" value={fName} onChange={(e) => setFName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') loadLeads(); }} />
          <select
            value={fStatus}
            onChange={(e) => setFStatus(e.target.value as typeof fStatus)}
            style={{ flex: '1 1 170px' }}
            aria-label="Outreach status"
          >
            <option value="all">All leads</option>
            <option value="none">Not started</option>
            <option value="draft">Ready to send</option>
            <option value="sent">Reached out</option>
          </select>
          <button className="btn" onClick={loadLeads} style={{ flexShrink: 0 }}>Apply filters</button>
        </div>
      </div>

      {/* Leads table */}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>{visibleLeads.length} lead{visibleLeads.length === 1 ? '' : 's'}{fStatus !== 'all' && leads.length !== visibleLeads.length ? <span className="muted" style={{ fontWeight: 400 }}> / {leads.length}</span> : null}</h2>
          {selLeads.size > 0 && (
            <span className="row" style={{ gap: 8 }}>
              <button className="btn ghost" onClick={removeSelected} disabled={busyGen}>Delete {selLeads.size}</button>
              <button className="btn" onClick={() => openLangModal(Array.from(selLeads))} disabled={busyGen}>
                {busyGen ? 'Generating…' : `Generate ${selLeads.size} message${selLeads.size === 1 ? '' : 's'}`}
              </button>
            </span>
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
              {pageLeads.map((l) => {
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
                          <span className="row" style={{ gap: 6 }}><span style={{ fontWeight: 600 }}>{name}</span>{statusBadge(l.messageStatus)}{l.enrich_status === 'partial' && <span className="badge progress" style={{ fontSize: 10 }} title="Profile incomplete (experience section throttled by LinkedIn) — will be re-enriched later">enriching…</span>}</span>
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
              {loadingLeads && leads.length === 0 && (
                <tr><td colSpan={6} className="muted">Loading…</td></tr>
              )}
              {!loadingLeads && leads.length === 0 && (
                <tr><td colSpan={6} className="muted">No leads yet — head to <Link href="/connections">Connections</Link> to add matching connections.</td></tr>
              )}
              {!loadingLeads && leads.length > 0 && visibleLeads.length === 0 && (
                <tr><td colSpan={6} className="muted">No leads match this filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {visibleLeads.length > 0 && (
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
            <button className="btn ghost sm" onClick={togglePage}>
              {pageAllSelected ? 'Deselect this page' : 'Select this page'}
            </button>
            {pageCount > 1 && (
              <span className="row" style={{ gap: 8, alignItems: 'center' }}>
                <button className="btn ghost sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={safePage <= 1}>Prev</button>
                <span className="muted" style={{ fontSize: 13 }}>Page {safePage} / {pageCount}</span>
                <button className="btn ghost sm" onClick={() => setPage((p) => Math.min(pageCount, p + 1))} disabled={safePage >= pageCount}>Next</button>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Generate → preview → send panel */}
      {preview && (
        <div className="modal-backdrop" onClick={closePreview}>
          <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Review &amp; send ({preview.length})</h2>
              <button className="btn ghost sm" onClick={closePreview}>Close</button>
            </div>
            {busyGen && (
              <div style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                  <span className="muted">Generating messages… {genDone}/{genTotal}</span>
                  <span className="muted">{genTotal > 0 ? Math.round((genDone / genTotal) * 100) : 0}%</span>
                </div>
                <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, overflow: 'hidden' }}>
                  <div style={{ width: `${genTotal > 0 ? Math.min(100, (genDone / genTotal) * 100) : 0}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))', transition: 'width .3s' }} />
                </div>
              </div>
            )}
            <p className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>Edit each message if you like, then send. Sends respect your daily limit.</p>
            {skippedCount > 0 && (
              <div className="notice warn" style={{ fontSize: 12.5 }}>
                {skippedCount} selected lead{skippedCount === 1 ? '' : 's'} skipped — not enriched yet. Only known contacts, or fully enriched leads, can be generated.
              </div>
            )}

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

      {/* Language picker → generate */}
      {langModal && (
        <div className="modal-backdrop" onClick={() => setLangModal(null)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>Message language</h2>
              <button className="btn ghost sm" onClick={() => setLangModal(null)}>Close</button>
            </div>
            <p className="muted" style={{ fontSize: 13, marginTop: 6 }}>
              {langModal.ids.length} lead{langModal.ids.length === 1 ? '' : 's'} — choose the language to generate in.
            </p>
            <div style={{ display: 'grid', gap: 8, margin: '12px 0 4px' }}>
              {[
                { v: 'auto', label: 'Auto — the lead’s profile language' },
                { v: 'en', label: 'English' },
                { v: 'fr', label: 'Français' },
                { v: 'nl', label: 'Nederlands' },
              ].map((o) => (
                <label key={o.v} className="row" style={{ gap: 8, cursor: 'pointer' }}>
                  <input type="radio" name="genlang" style={{ width: 'auto' }} checked={genLang === o.v} onChange={() => setGenLang(o.v)} />
                  {o.label}
                </label>
              ))}
            </div>
            <button className="btn" style={{ marginTop: 12, width: '100%' }} onClick={confirmGenerate}>
              Generate {langModal.ids.length} message{langModal.ids.length === 1 ? '' : 's'}
            </button>
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
          onGenerate={() => { const id = profileModal.lead.id; setProfileModal(null); openLangModal([id]); }}
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
                    <span className={`badge ${sent ? 'good' : 'info'}`}>{sent ? 'Sent' : 'Not sent yet'}</span>
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
          {(() => {
            const alreadyGenerated = messages.length > 0;
            // A NEW lead must be fully enriched to generate; a known contact can skip enrichment.
            const needsEnrichment = !lead.known && lead.enrich_status !== 'full';
            const disabled = alreadyGenerated || needsEnrichment;
            const label = alreadyGenerated
              ? 'Message already generated'
              : needsEnrichment
                ? 'Awaiting enrichment'
                : 'Generate message →';
            const title = alreadyGenerated
              ? 'A message was already generated for this lead — edit it in Messages'
              : needsEnrichment
                ? 'This lead must be enriched first (only known contacts can be generated without enrichment).'
                : undefined;
            return (
              <button className="btn" style={{ flex: 1 }} onClick={onGenerate} disabled={disabled} title={title}>
                {label}
              </button>
            );
          })()}
        </div>
      </aside>
    </>
  );
}
