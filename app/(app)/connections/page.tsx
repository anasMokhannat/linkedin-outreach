'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';

interface Staged {
  profileUrl: string;
  fullName: string;
  firstName?: string;
  lastName?: string;
  headline?: string;
  company?: string;
  title?: string;
  providerId?: string;
  alreadyLead?: boolean;
}

const STALE_MS = 24 * 60 * 60 * 1000;
// ICP keyword match: connections only carry a free-text headline pre-enrichment,
// so every ICP term is matched against the headline (+ name for the name field).
function matchTerm(haystack: string, term: string) {
  return !term || haystack.toLowerCase().includes(term.toLowerCase());
}

export default function ConnectionsPage() {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const [conns, setConns] = useState<Staged[]>([]);
  const [connsLoaded, setConnsLoaded] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('none');

  // ICP
  const [icpIndustry, setIcpIndustry] = useState('');
  const [icpTitle, setIcpTitle] = useState('');
  const [icpCompany, setIcpCompany] = useState('');
  const [icpName, setIcpName] = useState('');
  const [icpApplied, setIcpApplied] = useState(false);
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

  // Auto-fetch connections on open when never synced or stale (>24h).
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

  const icpResults = useMemo(() => {
    return conns.filter((c) => {
      // Only name + headline (and occasionally company/title) exist pre-enrichment,
      // so every filter term is matched against all of a connection's known text.
      const hay = [c.fullName, c.headline, c.company, c.title].filter(Boolean).join(' ');
      return (
        matchTerm(hay, icpIndustry) &&
        matchTerm(hay, icpTitle) &&
        matchTerm(hay, icpCompany) &&
        matchTerm(hay, icpName)
      );
    });
  }, [conns, icpIndustry, icpTitle, icpCompany, icpName]);

  const hasIcp = !!(icpIndustry || icpTitle || icpCompany || icpName);
  const eligibleUrls = useMemo(
    () => icpResults.filter((c) => !c.alreadyLead).map((c) => c.profileUrl),
    [icpResults]
  );
  const allSelected = eligibleUrls.length > 0 && eligibleUrls.every((u) => selConns.has(u));
  const eligibleCount = eligibleUrls.length;

  function applyIcp() {
    setIcpApplied(true);
    setSelConns(new Set());
  }
  function resetIcp() {
    setIcpIndustry(''); setIcpTitle(''); setIcpCompany(''); setIcpName('');
    setIcpApplied(false); setSelConns(new Set());
  }
  function toggleConn(url: string) {
    setSelConns((p) => { const n = new Set(p); n.has(url) ? n.delete(url) : n.add(url); return n; });
  }
  function toggleSelectAll() {
    setSelConns(allSelected ? new Set() : new Set(eligibleUrls));
  }

  async function addSelectedConns() {
    const chosen = icpResults.filter((c) => selConns.has(c.profileUrl) && !c.alreadyLead);
    if (!chosen.length) return setMsg('Nothing new selected.');
    setBusy((p) => ({ ...p, addConns: true }));
    setMsg(`Adding ${chosen.length} lead(s) and enriching…`);
    const res = await fetch('/api/leads/select', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ connections: chosen }),
    });
    const data = await res.json();
    setBusy((p) => ({ ...p, addConns: false }));
    if (!res.ok) setMsg('Save failed: ' + (data.error ?? res.status));
    else {
      setMsg(`Added ${data.inserted} lead(s)${typeof data.enriched === 'number' ? ` · enriched ${data.enriched}` : ''}. View them on the Leads page.`);
      setSelConns(new Set());
      loadConnections();
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Connections</h1>
          <div className="sub">Find matching 1st-degree connections and add them to your leads</div>
        </div>
        <div className="spacer" />
        <Link className="btn secondary" href="/leads">Go to Leads →</Link>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {/* ICP form */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Enter your ICP</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          Describe who you want to reach. Terms are matched against each connection&apos;s LinkedIn
          headline. {syncStatus === 'none' ? (busy.sync ? 'Syncing your connections…' : 'Loading your connections…') : `${conns.length} connections available.`}
        </p>
        <div className="grid cols-3" style={{ gap: 10 }}>
          <div>
            <label>Industry</label>
            <input placeholder="e.g. SaaS, fintech" value={icpIndustry} onChange={(e) => setIcpIndustry(e.target.value)} />
          </div>
          <div>
            <label>Title / role</label>
            <input placeholder="e.g. founder, head of sales" value={icpTitle} onChange={(e) => setIcpTitle(e.target.value)} />
          </div>
          <div>
            <label>Company</label>
            <input placeholder="e.g. Stripe" value={icpCompany} onChange={(e) => setIcpCompany(e.target.value)} />
          </div>
          <div>
            <label>Name</label>
            <input placeholder="Search by name" value={icpName} onChange={(e) => setIcpName(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12, gap: 8 }}>
          <button className="btn" onClick={applyIcp} disabled={!connsLoaded}>Show matching connections</button>
          {icpApplied && <button className="btn ghost" onClick={resetIcp}>Reset</button>}
          {icpApplied && (
            <span className="muted">{icpResults.length} match{icpResults.length === 1 ? '' : 'es'} · {eligibleCount} new</span>
          )}
        </div>
      </div>

      {/* ICP results */}
      {icpApplied && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Matching connections</h2>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn ghost sm" onClick={toggleSelectAll} disabled={eligibleCount === 0}>{allSelected ? 'Deselect all' : 'Select all new'}</button>
              <button className="btn" onClick={addSelectedConns} disabled={selConns.size === 0 || busy.addConns}>
                {busy.addConns ? 'Adding…' : `Add ${selConns.size || ''} to leads`}
              </button>
            </div>
          </div>
          {!hasIcp && <p className="muted" style={{ fontSize: 13 }}>No ICP terms set — showing all connections.</p>}
          <div className="table-wrap" style={{ maxHeight: 420, overflowY: 'auto', marginTop: 10 }}>
            <table>
              <thead><tr><th></th><th>Name</th><th>Headline</th></tr></thead>
              <tbody>
                {icpResults.slice(0, 300).map((c) => (
                  <tr key={c.profileUrl}>
                    <td style={{ width: 36 }}>
                      {c.alreadyLead ? <span className="badge good">✓</span> :
                        <input type="checkbox" style={{ width: 'auto' }} checked={selConns.has(c.profileUrl)} onChange={() => toggleConn(c.profileUrl)} />}
                    </td>
                    <td><a href={c.profileUrl} target="_blank" rel="noreferrer">{c.fullName}</a></td>
                    <td className="muted">{c.headline ?? '—'}</td>
                  </tr>
                ))}
                {icpResults.length === 0 && <tr><td colSpan={3} className="muted">No connections match this ICP.</td></tr>}
              </tbody>
            </table>
          </div>
          {icpResults.length > 300 && <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Showing first 300 of {icpResults.length}. Narrow your ICP to see the rest.</p>}
        </div>
      )}
    </div>
  );
}
