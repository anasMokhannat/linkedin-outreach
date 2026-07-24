'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

interface Staged {
  profileUrl: string;
  fullName: string;
  headline?: string;
  company?: string;
  title?: string;
  providerId?: string;
  alreadyLead?: boolean;
}

const STALE_MS = 24 * 60 * 60 * 1000;

export default function ConnectionsPage() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [conns, setConns] = useState<Staged[]>([]);
  const [connsLoaded, setConnsLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('none');
  const [selConns, setSelConns] = useState<Set<string>>(new Set());
  const autoSynced = useRef(false);

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

  // Auto-fetch on open when never synced or stale (>24h).
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

  const eligibleUrls = useMemo(() => conns.filter((c) => !c.alreadyLead).map((c) => c.profileUrl), [conns]);
  const allSelected = eligibleUrls.length > 0 && eligibleUrls.every((u) => selConns.has(u));

  function toggleConn(url: string) {
    setSelConns((p) => { const n = new Set(p); n.has(url) ? n.delete(url) : n.add(url); return n; });
  }
  function toggleSelectAll() {
    setSelConns(allSelected ? new Set() : new Set(eligibleUrls));
  }

  async function addSelectedConns() {
    const chosen = conns.filter((c) => selConns.has(c.profileUrl) && !c.alreadyLead);
    if (!chosen.length) return setMsg('Nothing new selected.');
    setBusy((p) => ({ ...p, add: true }));
    setMsg(`Adding ${chosen.length} lead(s) and enriching…`);
    const res = await fetch('/api/leads/select', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connections: chosen }),
    });
    const data = await res.json();
    setBusy((p) => ({ ...p, add: false }));
    if (!res.ok) setMsg('Save failed: ' + (data.error ?? res.status));
    else {
      setMsg(`Added ${data.inserted} lead(s)${typeof data.enriched === 'number' ? ` · enriched ${data.enriched}` : ''}. View them on the Leads page.`);
      setSelConns(new Set());
      loadConnections();
    }
  }

  const eligibleCount = eligibleUrls.length;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Connections</h1>
          <div className="sub">Connections that match your ideal customer profile</div>
        </div>
        <div className="spacer" />
        <Link className="btn secondary" href="/leads">Go to Leads</Link>
      </div>

      {msg && <div className="notice">{msg}</div>}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>
            {syncStatus === 'none' && !connsLoaded
              ? (busy.sync ? 'Syncing your connections…' : 'Loading…')
              : `${conns.length} matching connection${conns.length === 1 ? '' : 's'}`}
            {eligibleCount < conns.length && <span className="muted"> · {conns.length - eligibleCount} already added</span>}
          </h2>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost sm" onClick={toggleSelectAll} disabled={eligibleCount === 0}>{allSelected ? 'Deselect all' : 'Select all'}</button>
            <button className="btn" onClick={addSelectedConns} disabled={selConns.size === 0 || busy.add}>
              {busy.add ? 'Adding…' : `Add ${selConns.size || ''} to leads`}
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Filtered automatically to your target profile — add the ones you want to reach, then generate & send from Leads.
        </p>
        <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto', marginTop: 6 }}>
          <table>
            <thead><tr><th></th><th>Name</th><th>Headline</th></tr></thead>
            <tbody>
              {conns.slice(0, 500).map((c) => (
                <tr key={c.profileUrl}>
                  <td style={{ width: 36 }}>
                    {c.alreadyLead ? <span className="badge good">✓</span> :
                      <input type="checkbox" style={{ width: 'auto' }} checked={selConns.has(c.profileUrl)} onChange={() => toggleConn(c.profileUrl)} />}
                  </td>
                  <td><a href={c.profileUrl} target="_blank" rel="noreferrer">{c.fullName}</a></td>
                  <td className="muted">{c.headline ?? '—'}</td>
                </tr>
              ))}
              {connsLoaded && conns.length === 0 && (
                <tr><td colSpan={3} className="muted">No connections match your ICP yet — sync runs automatically on open.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {conns.length > 500 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Showing first 500 of {conns.length}.</p>}
      </div>
    </div>
  );
}
