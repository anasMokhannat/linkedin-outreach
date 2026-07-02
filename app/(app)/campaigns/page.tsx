'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { IconPlus } from '@/app/components/icons';

interface Campaign {
  id: string;
  name: string;
  status: string;
  cta: string | null;
  offer: string | null;
  leadCount: number;
  sentCount: number;
}
interface LeadOpt {
  id: string;
  first_name: string | null;
  last_name: string | null;
  current_title: string | null;
  current_company: string | null;
}
interface Offer {
  id: string;
  name: string;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Create form
  const [name, setName] = useState('');
  const [cta, setCta] = useState('');
  const [offers, setOffers] = useState<Offer[]>([]);
  const [chosenOffer, setChosenOffer] = useState('');
  const [leads, setLeads] = useState<LeadOpt[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch('/api/campaigns');
    const data = await res.json();
    setCampaigns(data.campaigns ?? []);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function openCreate() {
    setCreating(true);
    setName('');
    setCta('');
    setPicked(new Set());
    const [lRes, oRes] = await Promise.all([fetch('/api/leads'), fetch('/api/offers')]);
    const lData = await lRes.json();
    const oData = await oRes.json();
    setLeads(lData.leads ?? []);
    setOffers(oData.offers ?? []);
    setChosenOffer((oData.offers ?? [])[0]?.id ?? '');
  }

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    return leads.filter((l) => !ql || `${l.first_name ?? ''} ${l.last_name ?? ''}`.toLowerCase().includes(ql));
  }, [leads, q]);

  function toggle(id: string) {
    setPicked((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function create() {
    setBusy(true);
    setMsg(null);
    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), cta: cta.trim(), offerId: chosenOffer || undefined, leadIds: Array.from(picked) }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) setMsg('Create failed: ' + (data.error ?? res.status));
    else {
      setCreating(false);
      setMsg(`Campaign “${name}” created with ${data.leads} leads.`);
      load();
    }
  }

  const statusBadge = (s: string) =>
    s === 'active' ? 'good' : s === 'paused' ? 'warn' : 'plain';

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Campaigns</h1>
          <div className="sub">Group leads, generate a message for each, and send within limits</div>
        </div>
        <div className="spacer" />
        <button className="btn" onClick={openCreate}><IconPlus /> New campaign</button>
      </div>

      {msg && <div className="notice">{msg}</div>}

      <div className="grid cols-3">
        {campaigns.map((c) => {
          const pct = c.leadCount > 0 ? Math.round((c.sentCount / c.leadCount) * 100) : 0;
          return (
            <Link key={c.id} href={`/campaigns/${c.id}`} className="card campaign-card" style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 0 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <strong style={{ fontSize: 16 }}>{c.name}</strong>
                <span className={`badge ${statusBadge(c.status)}`}>{c.status}</span>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 8, minHeight: 34 }}>{c.cta || 'No CTA set'}</div>
              <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 999, marginTop: 10, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'linear-gradient(90deg, var(--accent), var(--accent-2))' }} />
              </div>
              <div className="row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
                <span className="muted" style={{ fontSize: 12.5 }}>{c.sentCount}/{c.leadCount} sent</span>
                <span className="muted" style={{ fontSize: 12.5 }}>{pct}%</span>
              </div>
            </Link>
          );
        })}
        {campaigns.length === 0 && <div className="card muted">No campaigns yet. Create one from your leads.</div>}
      </div>

      {creating && (
        <div className="modal-backdrop" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>New campaign</h2>
              <button className="btn ghost sm" onClick={() => setCreating(false)}>Close</button>
            </div>
            <label>Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Q3 founders outreach" />
            <label>Call to action (the goal of the message)</label>
            <input value={cta} onChange={(e) => setCta(e.target.value)} placeholder="Book a 15-min intro call" />
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

            <label style={{ marginTop: 12 }}>Leads ({picked.size} selected)</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search leads" style={{ marginBottom: 8 }} />
            <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--r-ctl)' }}>
              <table>
                <tbody>
                  {filtered.map((l) => (
                    <tr key={l.id} onClick={() => toggle(l.id)} style={{ cursor: 'pointer' }}>
                      <td style={{ width: 36 }}>
                        <input type="checkbox" style={{ width: 'auto' }} checked={picked.has(l.id)} readOnly />
                      </td>
                      <td>{[l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead'}</td>
                      <td className="muted">{l.current_title ?? '—'}{l.current_company ? ` · ${l.current_company}` : ''}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && <tr><td className="muted">No leads — add some on the Leads page first.</td></tr>}
                </tbody>
              </table>
            </div>

            <button className="btn" style={{ marginTop: 16 }} disabled={busy || !name.trim() || picked.size === 0} onClick={create}>
              {busy ? 'Creating…' : `Create campaign (${picked.size} leads)`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
