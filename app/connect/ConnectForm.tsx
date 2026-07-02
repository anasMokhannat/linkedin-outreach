'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Logo from '../components/Logo';

type Phase = 'form' | 'code' | 'awaiting';

interface ConnectResult {
  status?: string;
  checkpointType?: string;
  accountId?: string;
}

function isInApp(type?: string) {
  const t = (type ?? '').toUpperCase();
  return t.includes('IN_APP') || t.includes('APP_VALIDATION');
}

interface ConnectFormProps {
  /** When embedded (e.g. in Settings) skip the full-screen wrapper + footer. */
  embedded?: boolean;
  /** Called on a successful connect instead of navigating to the dashboard. */
  onConnected?: () => void;
}

export default function ConnectForm({ embedded = false, onConnected }: ConnectFormProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('form');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [checkpointType, setCheckpointType] = useState('');
  const [code, setCode] = useState('');
  const polling = useRef(false);

  const goDashboard = useCallback(() => {
    if (onConnected) {
      onConnected();
      return;
    }
    router.push('/dashboard');
    router.refresh();
  }, [router, onConnected]);

  function skip() {
    // Non-security UX flag so the entry router stops forcing the connect step.
    document.cookie = 'fl_skip_connect=1; path=/; max-age=' + 60 * 60 * 24 * 30;
    router.push('/dashboard');
    router.refresh();
  }

  function handle(data: ConnectResult) {
    if (data.status === 'connected') {
      goDashboard();
    } else if (data.status === 'checkpoint') {
      setAccountId(data.accountId ?? '');
      setCheckpointType(data.checkpointType ?? '');
      setErr(null);
      setPhase(isInApp(data.checkpointType) ? 'awaiting' : 'code');
    } else if (data.status === 'await_approval') {
      setAccountId(data.accountId ?? '');
      setErr(null);
      setPhase('awaiting');
    }
  }

  async function post(url: string, body: unknown): Promise<ConnectResult | null> {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) {
      setErr(data.error ?? `Failed (${res.status})`);
      return null;
    }
    return data as ConnectResult;
  }

  async function action(url: string, body: unknown) {
    setBusy(true);
    setErr(null);
    try {
      const data = await post(url, body);
      if (data) handle(data);
    } finally {
      setBusy(false);
    }
  }

  // While awaiting in-app approval, poll until connected.
  useEffect(() => {
    if (phase !== 'awaiting' || !accountId || polling.current) return;
    polling.current = true;
    let inFlight = false;
    const iv = setInterval(async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await post('/api/linkedin/poll', { accountId });
        if (data?.status === 'connected') {
          clearInterval(iv);
          polling.current = false;
          goDashboard();
        }
      } finally {
        inFlight = false;
      }
    }, 4000);
    return () => {
      clearInterval(iv);
      polling.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, accountId]);

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const inner = (
    <>
      {!embedded && <Logo height={28} />}
      {!embedded && <h1 style={{ fontSize: 21, marginTop: 16 }}>Connect your LinkedIn</h1>}
      <p className="muted" style={{ marginTop: embedded ? 0 : 4, fontSize: 14 }}>
        Connect the LinkedIn account you&apos;ll run outreach from. Your password is used once to
        connect and is never stored.
      </p>

      {err && <div className="notice bad" style={{ marginTop: 12 }}>{err}</div>}

        {phase === 'form' && (
          <>
            <label>LinkedIn email</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="you@example.com" autoComplete="off" />
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            <button className="btn" style={{ marginTop: 16, width: '100%' }} disabled={busy || !username.trim() || !password}
              onClick={() => action('/api/linkedin/connect-credentials', { username: username.trim(), password })}>
              {busy ? 'Connecting…' : 'Connect'}
            </button>
          </>
        )}

        {phase === 'code' && (
          <>
            <label style={{ marginTop: 14 }}>Verification code ({checkpointType || 'code'})</label>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" autoComplete="one-time-code" />
            <button className="btn" style={{ marginTop: 14, width: '100%' }} disabled={busy || !code.trim()}
              onClick={() => action('/api/linkedin/checkpoint', { accountId, code: code.trim() })}>
              {busy ? 'Verifying…' : 'Submit code'}
            </button>
            <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
              LinkedIn sent a code (email / SMS / authenticator app). Enter it to finish.
            </p>
          </>
        )}

      {phase === 'awaiting' && (
        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <div className="notice good">Approve the sign-in request in your LinkedIn mobile app.</div>
          <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>
            Waiting for you to approve… this will continue automatically once you confirm on your phone.
          </p>
        </div>
      )}

      {!embedded && (
        <div className="row" style={{ marginTop: 18, justifyContent: 'center', gap: 10 }}>
          <button className="btn ghost sm" onClick={signOut}>Sign out</button>
          <button className="btn ghost sm" onClick={skip}>Skip for now</button>
        </div>
      )}
    </>
  );

  if (embedded) return <div>{inner}</div>;
  return (
    <main className="center-wrap">
      <div className="card auth-card">{inner}</div>
    </main>
  );
}
