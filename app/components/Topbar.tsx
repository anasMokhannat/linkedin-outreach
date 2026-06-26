'use client';

import { useRouter } from 'next/navigation';
import Logo from './Logo';

export default function Topbar() {
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/signout', { method: 'POST' });
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
        <button className="btn ghost sm" onClick={signOut}>
          Sign out
        </button>
      </div>
    </header>
  );
}
