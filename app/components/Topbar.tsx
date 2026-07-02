'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Logo from './Logo';
import Notifications from './Notifications';

export default function Topbar({ linkedinConnected }: { linkedinConnected: boolean }) {
  const router = useRouter();

  async function signOut() {
    // App sign-out only: clears the app session, keeps LinkedIn connected.
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
    router.refresh();
  }

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
        <button className="btn ghost sm" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
