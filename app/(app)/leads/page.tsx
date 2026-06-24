'use client';

import { useCallback, useEffect, useState } from 'react';

interface Lead {
  id: string;
  profile_url: string;
  first_name: string | null;
  last_name: string | null;
  headline: string | null;
  current_company: string | null;
  current_title: string | null;
  location: string | null;
  school: string | null;
  industry: string | null;
  enriched_at: string | null;
  messageStatus: string | null;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const [location, setLocation] = useState('');
  const [school, setSchool] = useState('');
  const [industry, setIndustry] = useState('');
  const [goal, setGoal] = useState('Start a genuine conversation.');

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (location) params.set('location', location);
    if (school) params.set('school', school);
    if (industry) params.set('industry', industry);
    const res = await fetch('/api/leads?' + params.toString());
    const data = await res.json();
    setLeads(data.leads ?? []);
    setLoading(false);
  }, [location, school, industry]);

  useEffect(() => {
    load();
  }, [load]);

  function setLeadBusy(id: string, v: boolean) {
    setBusy((p) => ({ ...p, [id]: v }));
  }

  async function enrich(id: string) {
    setMsg(null);
    setLeadBusy(id, true);
    const res = await fetch(`/api/leads/${id}/enrich`, { method: 'POST' });
    const data = await res.json();
    setLeadBusy(id, false);
    if (!res.ok) setMsg('Enrich failed: ' + (data.error ?? res.status));
    else setMsg(`Enrichment started (${data.runs} actor run(s)). Refresh in a minute.`);
  }

  async function generate(id: string) {
    setMsg(null);
    setLeadBusy(id, true);
    const res = await fetch('/api/messages/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leadId: id, goal }),
    });
    const data = await res.json();
    setLeadBusy(id, false);
    if (!res.ok) setMsg('Generate failed: ' + (data.error ?? res.status));
    else {
      setMsg('Draft created — see the Messages tab to approve & send.');
      load();
    }
  }

  return (
    <div>
      <h1>Leads</h1>
      <p className="muted">
        Enrich uses cookieless public-data actors only — no session, no account risk. Tier-2
        filters become useful once leads are enriched.
      </p>

      <div className="card">
        <h2>Tier-2 filters</h2>
        <div className="grid cols-3">
          <div>
            <label>Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Berlin" />
          </div>
          <div>
            <label>School</label>
            <input value={school} onChange={(e) => setSchool(e.target.value)} placeholder="MIT" />
          </div>
          <div>
            <label>Industry</label>
            <input value={industry} onChange={(e) => setIndustry(e.target.value)} placeholder="Software" />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn secondary" onClick={load}>
            Apply filters
          </button>
        </div>
      </div>

      <div className="card">
        <label>Message goal (used when generating)</label>
        <input value={goal} onChange={(e) => setGoal(e.target.value)} />
      </div>

      {msg && <div className="notice" style={{ marginBottom: 16 }}>{msg}</div>}

      <div className="card">
        <h2>{loading ? 'Loading…' : `${leads.length} lead(s)`}</h2>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Title / Company</th>
                <th>Location</th>
                <th>Industry</th>
                <th>Enriched</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id}>
                  <td>
                    <a href={l.profile_url} target="_blank" rel="noreferrer">
                      {[l.first_name, l.last_name].filter(Boolean).join(' ') || 'Lead'}
                    </a>
                  </td>
                  <td className="muted">
                    {l.current_title ?? '—'}
                    {l.current_company ? ` · ${l.current_company}` : ''}
                  </td>
                  <td className="muted">{l.location ?? '—'}</td>
                  <td className="muted">{l.industry ?? '—'}</td>
                  <td>
                    {l.enriched_at ? (
                      <span className="badge good">yes</span>
                    ) : (
                      <span className="badge">no</span>
                    )}
                  </td>
                  <td>
                    <div className="row">
                      <button
                        className="btn secondary"
                        onClick={() => enrich(l.id)}
                        disabled={busy[l.id]}
                      >
                        Enrich
                      </button>
                      {l.messageStatus ? (
                        <span className="badge">{l.messageStatus}</span>
                      ) : (
                        <button className="btn" onClick={() => generate(l.id)} disabled={busy[l.id]}>
                          Generate
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
