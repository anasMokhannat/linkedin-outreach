'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ConnectForm from '@/app/connect/ConnectForm';
import { useConfirm } from '@/app/components/ConfirmDialog';
import { fetchJson } from '@/lib/fetch-json';

export default function SettingsPage() {
  const router = useRouter();
  const confirm = useConfirm();
  const [linkedinStatus, setLinkedinStatus] = useState<string>('');
  const [disconnecting, setDisconnecting] = useState(false);
  const [msg] = useState<string | null>(null);

  async function loadSettings() {
    try {
      const data = await fetchJson<{ linkedin?: { status?: string } }>('/api/settings');
      setLinkedinStatus(data.linkedin?.status ?? 'disconnected');
    } catch {
      setLinkedinStatus('disconnected');
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  const linkedinConnected = linkedinStatus === 'connected';

  async function onLinkedinConnected() {
    await loadSettings();
    router.refresh();
  }

  async function disconnect() {
    const ok = await confirm({
      title: 'Disconnect LinkedIn',
      message: 'Disconnect your LinkedIn account from Unipile? Your app account stays signed in.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (!ok) return;
    setDisconnecting(true);
    try {
      await fetchJson('/api/linkedin/connect', { method: 'DELETE' });
      router.push('/connect');
      router.refresh();
    } catch {
      setDisconnecting(false);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <div className="sub">Account &amp; LinkedIn connection</div>
        </div>
      </div>

      {msg && <div className="notice">{msg}</div>}

      {/* Sending limits (informational) */}
      <div className="card" style={{ maxWidth: 720 }}>
        <h2 style={{ marginTop: 0 }}>Sending limits</h2>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>
          To keep your LinkedIn account safe, starting new conversations is capped
          automatically and can&apos;t be changed. Replies to people who&apos;ve
          already written back don&apos;t count and aren&apos;t limited.
        </p>
        <div className="row" style={{ gap: 10 }}>
          <span className="badge plain">15 new conversations / day</span>
          <span className="badge plain">100 / week</span>
        </div>
      </div>

      {/* LinkedIn account */}
      <div className="card" style={{ maxWidth: 720, borderColor: linkedinConnected ? 'var(--bad)' : 'var(--border)' }}>
        <h2 style={{ marginTop: 0 }}>LinkedIn account</h2>
        <p className="muted">
          Status: <span className={`badge ${linkedinConnected ? 'good' : 'warn'}`}>{linkedinStatus || 'disconnected'}</span>
        </p>
        {linkedinConnected ? (
          <button className="btn danger" onClick={disconnect} disabled={disconnecting}>{disconnecting ? 'Disconnecting…' : 'Disconnect LinkedIn'}</button>
        ) : (
          <ConnectForm embedded onConnected={onLinkedinConnected} />
        )}
      </div>
    </div>
  );
}
