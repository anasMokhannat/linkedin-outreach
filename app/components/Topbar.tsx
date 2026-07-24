'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Logo from './Logo';
import Notifications from './Notifications';

function initials(s: string) {
  const parts = s.trim().split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || (s[0] ?? '?').toUpperCase();
}

export default function Topbar({
  linkedinConnected,
  email,
  companyName,
}: {
  linkedinConnected: boolean;
  email: string;
  companyName: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  async function signOut() {
    // App sign-out only: clears the app session, keeps LinkedIn connected.
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

  const label = companyName || email;

  return (
    <header className="topbar">
      <span className="brand">
        <Logo height={24} />
      </span>
      <div className="right">
        {!linkedinConnected && (
          <Link href="/connect" className="badge warn" style={{ textDecoration: 'none' }} title="Connect your LinkedIn to sync leads and send messages">
            LinkedIn not connected
          </Link>
        )}
        <Notifications />

        <div ref={boxRef} style={{ position: 'relative' }}>
          <button
            className="avatar-c"
            onClick={() => setOpen((v) => !v)}
            aria-label="Account menu"
            style={{ width: 34, height: 34, fontSize: 12.5, cursor: 'pointer', border: 'none', background: 'var(--accent)' }}
          >
            {initials(label || 'U')}
          </button>

          {open && (
            <div style={{
              position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 240,
              background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--r-card)',
              boxShadow: 'var(--shadow)', zIndex: 40, overflow: 'hidden',
            }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
                {companyName && <div style={{ fontWeight: 650, fontSize: 14 }}>{companyName}</div>}
                <div className="muted" style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
              </div>
              <button
                onClick={signOut}
                style={{
                  display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                  padding: '11px 14px', background: 'transparent', color: 'var(--text)', fontSize: 13.5,
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--surface-2)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
