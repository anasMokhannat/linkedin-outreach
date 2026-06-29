'use client';

import { useRouter } from 'next/navigation';
import Logo from './Logo';
import Notifications from './Notifications';

export default function Topbar() {
  const router = useRouter();

  async function signOut() {
    if (!confirm('Sign out and disconnect your LinkedIn account from Unipile?')) return;
    // Full disconnect: removes the Unipile account + clears the session.
    await fetch('/api/linkedin/connect', { method: 'DELETE' });
    router.push('/');
    router.refresh();
  }

  return (
    <header className="topbar">
      <span className="brand">
        <Logo height={24} />
      </span>
      <div className="right">
        <span className="badge good">LinkedIn connected</span>
        <Notifications />
        <button className="btn ghost sm" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
