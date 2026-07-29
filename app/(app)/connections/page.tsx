'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchJson } from '@/lib/fetch-json';

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
  const [connected, setConnected] = useState<boolean | null>(null); // null = still checking
  const [syncStatus, setSyncStatus] = useState<string>('none');
  const [selConns, setSelConns] = useState<Set<string>>(new Set());
  const autoSynced = useRef(false);

  const loadConnections = useCallback(async () => {
    try {
      const data = await fetchJson<{ status?: string; connections?: Staged[] }>('/api/connections');
      setSyncStatus(data.status ?? 'none');
      setConns(data.connections ?? []);
    } catch (e) {
      setMsg('Could not load connections: ' + (e instanceof Error ? e.message : 'error'));
    } finally {
      setConnsLoaded(true);
    }
  }, []);

  const sync = useCallback(async () => {
    setBusy((p) => ({ ...p, sync: true }));
    try {
      await fetchJson('/api/sync/connections', { method: 'POST' });
      await loadConnections();
      return true;
    } catch (e) {
      setMsg('Sync failed: ' + (e instanceof Error ? e.message : 'error'));
      return false;
    } finally {
      setBusy((p) => ({ ...p, sync: false }));
    }
  }, [loadConnections]);

  // Before loading anything, check whether LinkedIn is actually connected.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        setConnected((data.linkedin?.status ?? 'disconnected') === 'connected');
      } catch {
        setConnected(false);
      }
    })();
  }, []);

  // Auto-fetch on open when never synced or stale (>24h) — only once connected.
  useEffect(() => {
    if (connected !== true) return;
    if (autoSynced.current) return;
    autoSynced.current = true;
    (async () => {
      try {
        const m = await fetchJson<{ status?: string; lastSyncAt?: string | null; count?: number }>('/api/connections?meta=1');
        setSyncStatus(m.status ?? 'none');
        const stale = !m.lastSyncAt || Date.now() - new Date(m.lastSyncAt).getTime() > STALE_MS;
        if ((m.count ?? 0) === 0 || stale) {
          setMsg('Refreshing your connections…');
          await sync();
          setMsg(null);
        } else {
          await loadConnections();
        }
      } catch {
        // Meta check failed — fall back to a direct load so we leave "Loading…".
        await loadConnections();
      }
    })();
  }, [connected, sync, loadConnections]);

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
    try {
      const data = await fetchJson<{ inserted: number; enriched?: number }>('/api/leads/select', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connections: chosen }),
      });
      setMsg(`Added ${data.inserted} lead(s)${typeof data.enriched === 'number' ? ` · enriched ${data.enriched}` : ''}. View them on the Leads page.`);
      setSelConns(new Set());
      loadConnections();
    } catch (e) {
      setMsg('Save failed: ' + (e instanceof Error ? e.message : 'error'));
    } finally {
      setBusy((p) => ({ ...p, add: false }));
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

      {msg && connected === true && <div className="notice">{msg}</div>}

      {connected === null ? (
        <div className="card muted">Loading…</div>
      ) : connected === false ? (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>LinkedIn not connected</h2>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Connect your LinkedIn account to sync and browse your connections.
          </p>
          <Link className="btn" href="/connect">Connect LinkedIn</Link>
        </div>
      ) : (
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
      )}
    </div>
  );
}
