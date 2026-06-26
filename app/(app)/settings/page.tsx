'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SettingsPage() {
  const router = useRouter();
  const [leadsToMessage, setLeadsToMessage] = useState<number | ''>('');
  const [status, setStatus] = useState<string>('');
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/settings');
      const data = await res.json();
      const s = data.settings ?? {};
      setLeadsToMessage(s.leads_to_message ?? 50);
      setStatus(s.status ?? '');
    })();
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ leads_to_message: typeof leadsToMessage === 'number' ? leadsToMessage : undefined }),
    });
    const data = await res.json();
    setSaving(false);
    setMsg(res.ok ? 'Saved.' : 'Save failed: ' + (data.error ?? res.status));
  }

  async function disconnect() {
    if (!confirm('Disconnect your LinkedIn account and sign out?')) return;
    await fetch('/api/linkedin/connect', { method: 'DELETE' });
    router.push('/');
    router.refresh();
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="sub">Sending limits &amp; account</div>
        </div>
      </div>

      {msg && <div className="notice">{msg}</div>}

      <div className="card" style={{ maxWidth: 520 }}>
        <h2>Sending limits</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          To keep your LinkedIn account safe, sending is capped automatically. These limits are
          enforced by the app and can&apos;t be changed.
        </p>
        <div className="row" style={{ gap: 10 }}>
          <span className="badge plain">25 messages / day</span>
          <span className="badge plain">100 messages / week</span>
        </div>

        <label style={{ marginTop: 18 }}>Leads to message (target)</label>
        <input
          type="number"
          min={0}
          value={leadsToMessage}
          onChange={(e) => setLeadsToMessage(e.target.value === '' ? '' : Number(e.target.value))}
        />
        <div style={{ marginTop: 16 }}>
          <button className="btn" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <div className="card" style={{ maxWidth: 520, borderColor: 'var(--bad)' }}>
        <h2>LinkedIn account</h2>
        <p className="muted">
          Status: <span className={`badge ${status === 'connected' ? 'good' : 'warn'}`}>{status || 'unknown'}</span>
        </p>
        <button className="btn danger" onClick={disconnect}>
          Disconnect &amp; sign out
        </button>
      </div>
    </div>
  );
}
