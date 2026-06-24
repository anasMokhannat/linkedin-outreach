'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface StagedConnection {
  profileUrl: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  company?: string;
  title?: string;
  alreadyLead?: boolean;
}

type SyncStatus = 'none' | 'running' | 'succeeded' | 'failed';

export default function ConnectionsPage() {
  const [status, setStatus] = useState<SyncStatus>('none');
  const [connections, setConnections] = useState<StagedConnection[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);

  // Tier-1 filter (client-side over the staged set for instant UX).
  const [q, setQ] = useState('');
  const [company, setCompany] = useState('');
  const [role, setRole] = useState('');

  // Manual-paste fallback state.
  const [liAt, setLiAt] = useState('');
  const [proxyCountry, setProxyCountry] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch('/api/connections');
    const data = await res.json();
    setStatus(data.status ?? 'none');
    setConnections(data.connections ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while a sync is running.
  useEffect(() => {
    if (status !== 'running') return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [status, load]);

  const filtered = useMemo(() => {
    const ql = q.toLowerCase();
    const cl = company.toLowerCase();
    const rl = role.toLowerCase();
    return connections.filter((c) => {
      if (ql && !c.fullName.toLowerCase().includes(ql)) return false;
      if (cl && !(c.company ?? '').toLowerCase().includes(cl) && !(c.headline ?? '').toLowerCase().includes(cl))
        return false;
      if (rl && !(c.title ?? '').toLowerCase().includes(rl) && !(c.headline ?? '').toLowerCase().includes(rl))
        return false;
      return true;
    });
  }, [connections, q, company, role]);

  async function connectCookie() {
    setMsg(null);
    const res = await fetch('/api/linkedin/connect', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ liAt: liAt.trim(), proxyCountry: proxyCountry.trim() || undefined }),
    });
    const data = await res.json();
    if (!res.ok) setMsg('Connect failed: ' + (data.error ?? res.status));
    else {
      setMsg('Session connected. You can sync now.');
      setLiAt('');
    }
  }

  async function startSync() {
    setMsg(null);
    const res = await fetch('/api/sync/connections', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) setMsg('Sync failed: ' + (data.error ?? res.status));
    else {
      setStatus('running');
      setMsg('Sync started — this can take a minute.');
    }
  }

  function toggle(url: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  }

  async function persistSelected() {
    const chosen = filtered.filter((c) => selected.has(c.profileUrl) && !c.alreadyLead);
    if (chosen.length === 0) return setMsg('Nothing new selected.');
    const res = await fetch('/api/leads/select', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connections: chosen }),
    });
    const data = await res.json();
    if (!res.ok) setMsg('Save failed: ' + (data.error ?? res.status));
    else {
      setMsg(`Saved ${data.inserted} lead(s).`);
      setSelected(new Set());
      load();
    }
  }

  return (
    <div>
      <h1>Connections</h1>

      <div className="card">
        <h2>1 · Connect your session</h2>
        <p className="muted">
          Best: install the browser extension (reads the cookie for you). Fallback: paste your{' '}
          <code>li_at</code> below (DevTools → Application → Cookies → linkedin.com).
        </p>
        <div className="grid cols-2">
          <div>
            <label>li_at cookie value</label>
            <input
              type="password"
              value={liAt}
              onChange={(e) => setLiAt(e.target.value)}
              placeholder="AQED…"
              autoComplete="off"
            />
          </div>
          <div>
            <label>Proxy country (2-letter, optional)</label>
            <input value={proxyCountry} onChange={(e) => setProxyCountry(e.target.value)} placeholder="US" />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={connectCookie} disabled={liAt.trim().length < 20}>
            Save session
          </button>
        </div>
      </div>

      <div className="card">
        <h2>2 · Sync connections</h2>
        <div className="row">
          <button className="btn" onClick={startSync} disabled={status === 'running'}>
            {status === 'running' ? 'Syncing…' : 'Sync now'}
          </button>
          <span className="muted">Status: {status}</span>
        </div>
        {status === 'failed' && (
          <div className="notice warn" style={{ marginTop: 10 }}>
            Last sync failed — your session may need reconnecting.
          </div>
        )}
      </div>

      {msg && <div className="notice" style={{ marginBottom: 16 }}>{msg}</div>}

      <div className="card">
        <h2>3 · Filter &amp; select (Tier-1)</h2>
        <div className="grid cols-3">
          <div>
            <label>Name</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jane" />
          </div>
          <div>
            <label>Company</label>
            <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme" />
          </div>
          <div>
            <label>Role</label>
            <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Engineer" />
          </div>
        </div>

        <div className="row" style={{ margin: '14px 0' }}>
          <button className="btn" onClick={persistSelected} disabled={selected.size === 0}>
            Add {selected.size || ''} selected to Leads
          </button>
          <span className="muted">
            {loading ? 'Loading…' : `${filtered.length} shown`}
          </span>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th></th>
                <th>Name</th>
                <th>Headline</th>
                <th>Company</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 300).map((c) => (
                <tr key={c.profileUrl}>
                  <td>
                    {c.alreadyLead ? (
                      <span className="badge good">lead</span>
                    ) : (
                      <input
                        type="checkbox"
                        style={{ width: 'auto' }}
                        checked={selected.has(c.profileUrl)}
                        onChange={() => toggle(c.profileUrl)}
                      />
                    )}
                  </td>
                  <td>
                    <a href={c.profileUrl} target="_blank" rel="noreferrer">
                      {c.fullName}
                    </a>
                  </td>
                  <td className="muted">{c.headline ?? '—'}</td>
                  <td className="muted">{c.company ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length > 300 && (
            <p className="muted" style={{ fontSize: 13 }}>
              Showing first 300. Narrow the filter to see more.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
