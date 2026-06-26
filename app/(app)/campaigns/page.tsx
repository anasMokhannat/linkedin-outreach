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

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  // Create form
  const [name, setName] = useState('');
  const [cta, setCta] = useState('');
  const [offer, setOffer] = useState('');
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
    setOffer('');
    setPicked(new Set());
    const res = await fetch('/api/leads');
    const data = await res.json();
    setLeads(data.leads ?? []);
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
      body: JSON.stringify({ name: name.trim(), cta: cta.trim(), offer: offer.trim(), leadIds: Array.from(picked) }),
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
    s === 'active' ? 'good' : s === 'paused' ? 'warn' : s === 'done' ? 'plain' : 'plain';

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
        {campaigns.map((c) => (
          <Link key={c.id} href={`/campaigns/${c.id}`} className="stat-card" style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong style={{ fontSize: 16 }}>{c.name}</strong>
              <span className={`badge ${statusBadge(c.status)}`}>{c.status}</span>
            </div>
            <div className="muted" style={{ fontSize: 13, marginTop: 8, minHeight: 34 }}>{c.cta || 'No CTA set'}</div>
            <div className="row" style={{ justifyContent: 'space-between', marginTop: 12 }}>
              <span className="muted" style={{ fontSize: 13 }}>{c.leadCount} leads</span>
              <span className="muted" style={{ fontSize: 13 }}>{c.sentCount} sent</span>
            </div>
          </Link>
        ))}
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
            <label>Your offer (what you help with)</label>
            <textarea rows={2} value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="We help B2B SaaS teams cut onboarding time by 40%…" />

            <label>Leads ({picked.size} selected)</label>
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
