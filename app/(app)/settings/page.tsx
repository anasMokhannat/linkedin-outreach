'use client';

import { useEffect, useState } from 'react';

interface Profile {
  timezone?: string;
  dms_start_cap?: number;
  dms_max_cap?: number;
  ramp_per_week?: number;
  working_start_hour?: number;
  working_end_hour?: number;
  value_prop?: string;
  openrouter_model?: string;
}
interface Account {
  status: string;
  proxy_country: string | null;
  last_validated: string | null;
}

export default function SettingsPage() {
  const [profile, setProfile] = useState<Profile>({});
  const [account, setAccount] = useState<Account | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setProfile(data.profile ?? {});
      setAccount(data.account ?? null);
    })();
  }, []);

  function set<K extends keyof Profile>(k: K, v: Profile[K]) {
    setProfile((p) => ({ ...p, [k]: v }));
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    setSaving(false);
    setMsg(res.ok ? 'Saved.' : 'Save failed: ' + (data.error ?? res.status));
  }

  async function disconnect() {
    if (!confirm('Disconnect and purge your stored LinkedIn session?')) return;
    const res = await fetch('/api/linkedin/connect', { method: 'DELETE' });
    if (res.ok) {
      setMsg('Session disconnected.');
      setAccount((a) => (a ? { ...a, status: 'disconnected' } : a));
    }
  }

  const numField = (label: string, key: keyof Profile, min = 0) => (
    <div>
      <label>{label}</label>
      <input
        type="number"
        min={min}
        value={profile[key] ?? ''}
        onChange={(e) => set(key, (e.target.value === '' ? undefined : Number(e.target.value)) as never)}
      />
    </div>
  );

  return (
    <div>
      <h1>Settings</h1>

      <div className="card">
        <h2>LinkedIn session</h2>
        {account ? (
          <>
            <p>
              Status: <span className="badge">{account.status}</span>
              {account.last_validated
                ? ` · validated ${new Date(account.last_validated).toLocaleString()}`
                : ' · not validated yet'}
            </p>
            <div className="row">
              <a className="btn secondary" href="/connections">
                Reconnect / change cookie
              </a>
              <button className="btn danger" onClick={disconnect}>
                Disconnect
              </button>
            </div>
          </>
        ) : (
          <p className="muted">
            No session connected. <a href="/connections">Connect →</a>
          </p>
        )}
      </div>

      <div className="card">
        <h2>Sending limits &amp; schedule</h2>
        <div className="grid cols-3">
          {numField('Start cap (DMs/day)', 'dms_start_cap', 1)}
          {numField('Max cap (DMs/day)', 'dms_max_cap', 1)}
          {numField('Ramp per week', 'ramp_per_week', 0)}
          {numField('Working start hour (0-23)', 'working_start_hour', 0)}
          {numField('Working end hour (1-24)', 'working_end_hour', 1)}
          <div>
            <label>Timezone (IANA)</label>
            <input
              value={profile.timezone ?? ''}
              onChange={(e) => set('timezone', e.target.value)}
              placeholder="Europe/Paris"
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Personalization</h2>
        <label>Your value proposition (used to ground messages)</label>
        <textarea
          rows={3}
          value={profile.value_prop ?? ''}
          onChange={(e) => set('value_prop', e.target.value)}
          placeholder="I help B2B SaaS teams cut onboarding time…"
        />
        <label>OpenRouter model override (optional)</label>
        <input
          value={profile.openrouter_model ?? ''}
          onChange={(e) => set('openrouter_model', e.target.value)}
          placeholder="openai/gpt-4o-mini"
        />
      </div>

      {msg && <div className="notice" style={{ marginBottom: 14 }}>{msg}</div>}
      <button className="btn" onClick={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </button>
    </div>
  );
}
