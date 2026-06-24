'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { DEV_AUTH_ENABLED, DEV_USER } from '@/lib/dev';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function devLogin() {
    setLoading(true);
    setError(null);
    try {
      // Ensure the dev user exists + is confirmed, then sign in with password.
      const seed = await fetch('/api/dev/login', { method: 'POST' });
      if (!seed.ok) throw new Error('Dev login is disabled or the seed call failed.');
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword(DEV_USER);
      if (error) throw error;
      router.push('/dashboard');
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dev login failed');
      setLoading(false);
    }
  }

  async function signIn() {
    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      // Supabase provider slug for LinkedIn OIDC ("Sign in with LinkedIn").
      provider: 'linkedin_oidc',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'openid profile email',
      },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
    // On success the browser is redirected to LinkedIn.
  }

  return (
    <main className="center-wrap">
      <div className="card auth-card">
        <h1>Sign in</h1>
        <p className="muted">
          We use “Sign in with LinkedIn” only to identify you. Connecting your session for syncing
          and sending is a separate step inside the app.
        </p>
        {error && <div className="notice bad">{error}</div>}
        <button className="btn" onClick={signIn} disabled={loading} style={{ marginTop: 14 }}>
          {loading ? 'Redirecting…' : 'Sign in with LinkedIn'}
        </button>

        {DEV_AUTH_ENABLED && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <p className="muted" style={{ fontSize: 12 }}>
              Dev mode — skip LinkedIn auth and sign in as a local test user.
            </p>
            <button className="btn secondary" onClick={devLogin} disabled={loading}>
              {loading ? 'Signing in…' : 'Dev login (no LinkedIn)'}
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
