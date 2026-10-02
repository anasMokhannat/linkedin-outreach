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
  const [knownConns, setKnownConns] = useState<Set<string>>(new Set()); // marked "I already know them"
  const [page, setPage] = useState(1);
  const autoSynced = useRef(false);
  // "Removed" view — connections the user hid from the list (restorable).
  const [view, setView] = useState<'active' | 'removed'>('active');
  const [removedConns, setRemovedConns] = useState<Staged[]>([]);
  const [removedLoaded, setRemovedLoaded] = useState(false);
  const [selRemoved, setSelRemoved] = useState<Set<string>>(new Set());

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
  function toggleKnown(url: string) {
    setKnownConns((p) => { const n = new Set(p); n.has(url) ? n.delete(url) : n.add(url); return n; });
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
    // The select endpoint accepts at most 1000 per request — send in chunks so
    // large "Select all" batches don't fail.
    const CHUNK = 1000;
    const payload = chosen.map((c) => ({ ...c, known: knownConns.has(c.profileUrl) }));
    try {
      let inserted = 0;
      for (let i = 0; i < payload.length; i += CHUNK) {
        const slice = payload.slice(i, i + CHUNK);
        const data = await fetchJson<{ inserted: number }>('/api/leads/select', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ connections: slice }),
        });
        inserted += data.inserted;
        if (payload.length > CHUNK) setMsg(`Adding leads… ${Math.min(i + CHUNK, payload.length)}/${payload.length}`);
      }
      setMsg(`Added ${inserted} lead(s). Open the Leads page — enrichment runs there automatically.`);
      setSelConns(new Set());
      setKnownConns(new Set());
      loadConnections();
    } catch (e) {
      setMsg('Save failed: ' + (e instanceof Error ? e.message : 'error'));
    } finally {
      setBusy((p) => ({ ...p, add: false }));
    }
  }

  const loadRemoved = useCallback(async () => {
    try {
      const data = await fetchJson<{ connections?: Staged[] }>('/api/connections?view=removed');
      setRemovedConns(data.connections ?? []);
    } catch (e) {
      setMsg('Could not load removed connections: ' + (e instanceof Error ? e.message : 'error'));
    } finally {
      setRemovedLoaded(true);
    }
  }, []);

  function switchView(v: 'active' | 'removed') {
    setView(v);
    setMsg(null);
    if (v === 'removed') { setSelRemoved(new Set()); loadRemoved(); }
    else { setSelConns(new Set()); }
  }

  // Bring removed connections back into the active list.
  async function restoreConns(urls: string[]) {
    if (!urls.length) return;
    const set = new Set(urls);
    setRemovedConns((prev) => prev.filter((c) => !set.has(c.profileUrl)));
    setSelRemoved((p) => { const n = new Set(p); urls.forEach((u) => n.delete(u)); return n; });
    try {
      await fetchJson('/api/connections/dismiss', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileUrls: urls, restore: true }),
      });
      loadConnections(); // refresh the active list so restored ones reappear
    } catch (e) {
      setMsg('Could not restore: ' + (e instanceof Error ? e.message : 'error'));
      loadRemoved();
    }
  }
  function toggleRemoved(url: string) {
    setSelRemoved((p) => { const n = new Set(p); n.has(url) ? n.delete(url) : n.add(url); return n; });
  }
  const allRemovedSelected = removedConns.length > 0 && removedConns.every((c) => selRemoved.has(c.profileUrl));
  function toggleSelectAllRemoved() {
    setSelRemoved(allRemovedSelected ? new Set() : new Set(removedConns.map((c) => c.profileUrl)));
  }

  // Remove connection(s) from the in-app list only (NOT from LinkedIn). They're
  // marked dismissed on the account so they stay hidden across future syncs.
  async function dismissConns(urls: string[]) {
    if (!urls.length) return;
    const set = new Set(urls);
    // Optimistic: drop from the visible list + any selection/known state.
    setConns((prev) => prev.filter((c) => !set.has(c.profileUrl)));
    setSelConns((p) => { const n = new Set(p); urls.forEach((u) => n.delete(u)); return n; });
    setKnownConns((p) => { const n = new Set(p); urls.forEach((u) => n.delete(u)); return n; });
    try {
      await fetchJson('/api/connections/dismiss', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileUrls: urls }),
      });
    } catch (e) {
      setMsg('Could not remove: ' + (e instanceof Error ? e.message : 'error'));
      loadConnections(); // re-sync the list if the server rejected it
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
        <div className="row" style={{ gap: 8, marginBottom: 12 }}>
          <button className={`btn sm ${view === 'active' ? '' : 'ghost'}`} onClick={() => switchView('active')}>Active</button>
          <button className={`btn sm ${view === 'removed' ? '' : 'ghost'}`} onClick={() => switchView('removed')}>
            Removed{removedConns.length ? ` (${removedConns.length})` : ''}
          </button>
        </div>

        {view === 'active' ? (
        <>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>
            {syncStatus === 'none' && !connsLoaded
              ? (busy.sync ? 'Syncing your connections…' : 'Loading…')
              : `${conns.length} matching connection${conns.length === 1 ? '' : 's'}`}
            {eligibleCount < conns.length && <span className="muted"> · {conns.length - eligibleCount} already added</span>}
          </h2>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost sm" onClick={toggleSelectAll} disabled={eligibleCount === 0}>{allSelected ? 'Deselect all' : 'Select all'}</button>
            {selConns.size > 0 && (
              <button className="btn ghost sm" onClick={() => dismissConns(Array.from(selConns))} disabled={busy.add} title="Remove the selected connections from this list (does not affect your LinkedIn connection)">
                Remove {selConns.size}
              </button>
            )}
            <button className="btn" onClick={addSelectedConns} disabled={selConns.size === 0 || busy.add}>
              {busy.add ? 'Adding…' : `Add ${selConns.size || ''} to leads`}
            </button>
          </div>
        </div>
        <p className="muted" style={{ fontSize: 13 }}>
          Filtered automatically to your target profile — add the ones you want to reach, then generate & send from Leads.
        </p>
        <div className="notice warn" style={{ fontSize: 12.5 }}>
          Tip: don&apos;t add more than <strong>~100 leads/day</strong> per LinkedIn account. Beyond that, LinkedIn
          throttles profile data (missing company/title) and may restrict the account.
        </div>
        <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto', marginTop: 6 }}>
          <table>
            <thead><tr><th></th><th>Name</th><th>Headline</th><th style={{ width: 90 }} title="Toggle on the connections you already know — they won't be enriched and will get a warmer message">Known</th><th style={{ width: 44 }} aria-label="Remove" /></tr></thead>
            <tbody>
              {pageConns.map((c) => (
                <tr key={c.profileUrl}>
                  <td style={{ width: 36 }}>
                    {c.alreadyLead ? <span className="badge good">✓</span> :
                      <input type="checkbox" style={{ width: 'auto' }} checked={selConns.has(c.profileUrl)} onChange={() => toggleConn(c.profileUrl)} />}
                  </td>
                  <td><a href={c.profileUrl} target="_blank" rel="noreferrer">{c.fullName}</a></td>
                  <td className="muted">{c.headline ?? '—'}</td>
                  <td>
                    {!c.alreadyLead && (
                      <label className="switch" title="I already know this person — skip enrichment, use a warm message">
                        <input type="checkbox" checked={knownConns.has(c.profileUrl)} onChange={() => toggleKnown(c.profileUrl)} />
                        <span className="track" /><span className="thumb" />
                      </label>
                    )}
                  </td>
                  <td>
                    <button className="btn ghost sm" title="Remove from this list (does not remove your LinkedIn connection)" aria-label="Remove from list" onClick={() => dismissConns([c.profileUrl])}>✕</button>
                  </td>
                </tr>
              ))}
              {connsLoaded && conns.length === 0 && (
                <tr><td colSpan={5} className="muted">No connections match your ICP yet — sync runs automatically on open.</td></tr>
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
        </>
        ) : (
        <>
          <p className="muted" style={{ fontSize: 13 }}>
            Connections you removed from this list. Restoring brings them back to the active list — your actual LinkedIn connection was never affected.
          </p>
          <div className="row" style={{ gap: 8, marginBottom: 6 }}>
            <button className="btn ghost sm" onClick={toggleSelectAllRemoved} disabled={removedConns.length === 0}>
              {allRemovedSelected ? 'Deselect all' : 'Select all'}
            </button>
            {selRemoved.size > 0 && (
              <button className="btn" onClick={() => restoreConns(Array.from(selRemoved))}>Restore {selRemoved.size}</button>
            )}
          </div>
          <div className="table-wrap" style={{ maxHeight: 520, overflowY: 'auto', marginTop: 6 }}>
            <table>
              <thead><tr><th></th><th>Name</th><th>Headline</th><th style={{ width: 80 }} aria-label="Restore" /></tr></thead>
              <tbody>
                {removedConns.map((c) => (
                  <tr key={c.profileUrl}>
                    <td style={{ width: 36 }}>
                      <input type="checkbox" style={{ width: 'auto' }} checked={selRemoved.has(c.profileUrl)} onChange={() => toggleRemoved(c.profileUrl)} />
                    </td>
                    <td><a href={c.profileUrl} target="_blank" rel="noreferrer">{c.fullName}</a></td>
                    <td className="muted">{c.headline ?? '—'}</td>
                    <td>
                      <button className="btn ghost sm" title="Restore to the active list" onClick={() => restoreConns([c.profileUrl])}>Restore</button>
                    </td>
                  </tr>
                ))}
                {!removedLoaded && (
                  <tr><td colSpan={4} className="muted">Loading…</td></tr>
                )}
                {removedLoaded && removedConns.length === 0 && (
                  <tr><td colSpan={4} className="muted">No removed connections.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
        )}
      </div>
      )}
    </div>
  );
}
