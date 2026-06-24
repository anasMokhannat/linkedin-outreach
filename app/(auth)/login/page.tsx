'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <main className="container">
      <div className="card" style={{ maxWidth: 440, margin: '60px auto' }}>
        <h1>Sign in</h1>
        <p className="muted">
          We use “Sign in with LinkedIn” only to identify you. Connecting your session for syncing
          and sending is a separate step inside the app.
        </p>
        {error && <div className="notice bad">{error}</div>}
        <button className="btn" onClick={signIn} disabled={loading} style={{ marginTop: 14 }}>
          {loading ? 'Redirecting…' : 'Sign in with LinkedIn'}
        </button>
      </div>
    </main>
  );
}
