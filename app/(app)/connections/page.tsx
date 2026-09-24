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
const CONNS_PAGE_SIZE = 50;

export default function ConnectionsPage() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [conns, setConns] = useState<Staged[]>([]);
  const [connsLoaded, setConnsLoaded] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null); // null = still checking
  const [syncStatus, setSyncStatus] = useState<string>('none');
  const [selConns, setSelConns] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const autoSynced = useRef(false);

  // Single request: the connections endpoint already returns the account status
  // (409 when no LinkedIn), the cached connections AND lastSyncAt — no separate
  // /api/settings pre-check or ?meta=1 round-trip (no waterfall).
  const loadConnections = useCallback(async () => {
    try {
      const res = await fetch('/api/connections');
      if (res.status === 409) { setConnected(false); return undefined; } // no LinkedIn connected
      const data = (await res.json().catch(() => ({}))) as {
        error?: string; status?: string; lastSyncAt?: string | null; connections?: Staged[];
      };
      if (!res.ok) {
        setConnected(true);
        setMsg('Could not load connections: ' + (data.error ?? res.status));
        return undefined;
      }
      setConnected(true);
      setSyncStatus(data.status ?? 'none');
      setConns(data.connections ?? []);
      return data;
    } catch {
      setConnected(true);
      setMsg('Could not load connections.');
      return undefined;
    } finally {
      setConnsLoaded(true);
    }
  }, []);

  // Non-blocking refresh: sync in the background, then reload the list.
  const backgroundSync = useCallback(async () => {
    setBusy((p) => ({ ...p, sync: true }));
    setMsg('Refreshing your connections…');
    try {
      await fetchJson('/api/sync/connections', { method: 'POST' });
      await loadConnections();
      setMsg(null);
    } catch (e) {
      setMsg('Sync failed: ' + (e instanceof Error ? e.message : 'error'));
    } finally {
      setBusy((p) => ({ ...p, sync: false }));
    }
  }, [loadConnections]);

  // Show the cached list immediately; if it's empty or stale (>24h), refresh in
  // the background so the page never blocks on the sync.
  useEffect(() => {
    (async () => {
      const data = await loadConnections();
      if (!data || autoSynced.current) return;
      const stale = !data.lastSyncAt || Date.now() - new Date(data.lastSyncAt).getTime() > STALE_MS;
      if ((data.connections?.length ?? 0) === 0 || stale) {
        autoSynced.current = true;
        void backgroundSync();
      }
    })();
  }, [loadConnections, backgroundSync]);

  const eligibleUrls = useMemo(() => conns.filter((c) => !c.alreadyLead).map((c) => c.profileUrl), [conns]);
  const allSelected = eligibleUrls.length > 0 && eligibleUrls.every((u) => selConns.has(u));

  function toggleConn(url: string) {
    setSelConns((p) => { const n = new Set(p); n.has(url) ? n.delete(url) : n.add(url); return n; });
  }
  function toggleSelectAll() {
    // Spans ALL pages (every eligible connection in the filtered set).
    setSelConns(allSelected ? new Set() : new Set(eligibleUrls));
  }

  // Client-side pagination + per-page selection (eligible connections only).
  const pageCount = Math.max(1, Math.ceil(conns.length / CONNS_PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageConns = conns.slice((safePage - 1) * CONNS_PAGE_SIZE, safePage * CONNS_PAGE_SIZE);
  const pageEligible = pageConns.filter((c) => !c.alreadyLead).map((c) => c.profileUrl);
  const pageAllSelected = pageEligible.length > 0 && pageEligible.every((u) => selConns.has(u));
  function togglePage() {
    setSelConns((prev) => {
      const n = new Set(prev);
      if (pageAllSelected) pageEligible.forEach((u) => n.delete(u));
      else pageEligible.forEach((u) => n.add(u));
      return n;
    });
  }

  async function addSelectedConns() {
    const chosen = conns.filter((c) => selConns.has(c.profileUrl) && !c.alreadyLead);
    if (!chosen.length) return setMsg('Nothing new selected.');
    setBusy((p) => ({ ...p, add: true }));
    setMsg(`Adding ${chosen.length} lead(s)…`);
    try {
      const data = await fetchJson<{ inserted: number }>('/api/leads/select', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ connections: chosen }),
      });
      setMsg(`Added ${data.inserted} lead(s). Open the Leads page — enrichment runs there automatically.`);
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
        <div className="notice warn" style={{ fontSize: 12.5 }}>
          Tip: don&apos;t enrich more than <strong>~100 leads/day</strong> per LinkedIn account. Beyond that, LinkedIn
          throttles profile data (missing company/title) and may restrict the account.
        </div>
        <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto', marginTop: 6 }}>
          <table>
            <thead><tr><th></th><th>Name</th><th>Headline</th></tr></thead>
            <tbody>
              {pageConns.map((c) => (
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
        {conns.length > 0 && (
          <div className="row" style={{ justifyContent: 'space-between', marginTop: 12, flexWrap: 'wrap', gap: 8 }}>
            <button className="btn ghost sm" onClick={togglePage} disabled={pageEligible.length === 0}>
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
      )}
    </div>
  );
}
