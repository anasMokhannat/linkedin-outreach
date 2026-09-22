'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Logo from '../components/Logo';
import { IconEye, IconEyeOff } from '../components/icons';
import { fetchJson } from '@/lib/fetch-json';

export default function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [writerRole, setWriterRole] = useState<'partner' | 'associate'>('partner');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isRegister = mode === 'register';
  const passwordsMismatch = isRegister && confirmPassword.length > 0 && password !== confirmPassword;

  async function submit() {
    if (isRegister && password !== confirmPassword) {
      setErr('Passwords do not match.');
      return;
    }
    setBusy(true);
    setErr(null);
    const body = isRegister
      ? { email: email.trim(), password, confirmPassword, writerRole }
      : { email: email.trim(), password };
    try {
      await fetchJson(isRegister ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      // Root decides next stop (connect vs dashboard) based on LinkedIn state.
      router.push('/');
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong — please try again.');
      setBusy(false);
    }
  }

  const canSubmit =
    !busy &&
    !!email.trim() &&
    password.length >= (isRegister ? 8 : 1) &&
    (!isRegister || password === confirmPassword);

  return (
    <main className="center-wrap">
      <div className="card auth-card">
        <Logo height={28} />
        <h1 style={{ fontSize: 21, marginTop: 16 }}>{isRegister ? 'Create your account' : 'Welcome back'}</h1>
        <p className="muted" style={{ marginTop: 4, fontSize: 14 }}>
          {isRegister ? 'Sign up to start running LinkedIn outreach.' : 'Sign in to your Flugia account.'}
        </p>

        {err && <div className="notice bad" style={{ marginTop: 12 }}>{err}</div>}

        {isRegister && (
          <>
            <label style={{ marginTop: 14 }}>Vous êtes…</label>
            <div style={{ display: 'grid', gap: 8, marginTop: 2 }}>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="radio" name="writerRole" style={{ width: 'auto' }} checked={writerRole === 'partner'} onChange={() => setWriterRole('partner')} />
                Partenaire — je revends / recommande FLUGIA
              </label>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input type="radio" name="writerRole" style={{ width: 'auto' }} checked={writerRole === 'associate'} onChange={() => setWriterRole('associate')} />
                Associé — je fais partie de FLUGIA
              </label>
            </div>
          </>
        )}

        <label style={{ marginTop: 14 }}>Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@company.com"
          autoComplete="email"
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        />
        <label>Password</label>
        <div className="pw-field">
          <input
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={isRegister ? 'At least 8 characters' : ''}
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          />
          <button
            type="button"
            className="pw-toggle"
            aria-label={showPw ? 'Hide password' : 'Show password'}
            onClick={() => setShowPw((v) => !v)}
          >
            {showPw ? <IconEyeOff /> : <IconEye />}
          </button>
        </div>

        {isRegister && (
          <>
            <label>Confirm password</label>
            <div className="pw-field">
              <input
                type={showPw ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
              />
              <button
                type="button"
                className="pw-toggle"
                aria-label={showPw ? 'Hide password' : 'Show password'}
                onClick={() => setShowPw((v) => !v)}
              >
                {showPw ? <IconEyeOff /> : <IconEye />}
              </button>
            </div>
            {passwordsMismatch && (
              <p style={{ color: 'var(--bad)', fontSize: 12.5, margin: '6px 0 0' }}>Passwords do not match.</p>
            )}
          </>
        )}

        <button
          className="btn"
          style={{ marginTop: 16, width: '100%' }}
          disabled={!canSubmit}
          onClick={submit}
        >
          {busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}
        </button>

        <p className="muted" style={{ fontSize: 13, marginTop: 14, textAlign: 'center' }}>
          {isRegister ? (
            <>Already have an account? <Link href="/login">Sign in</Link></>
          ) : (
            <>New here? <Link href="/register">Create an account</Link></>
          )}
        </p>
      </div>
    </main>
  );
}
