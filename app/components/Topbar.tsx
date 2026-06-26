'use client';

import { useRouter } from 'next/navigation';

export default function Topbar() {
  const router = useRouter();

  async function signOut() {
    await fetch('/api/auth/signout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <header className="topbar">
      <span className="logo">
        <span className="mark">in</span>
        Outreach
      </span>
      <div className="search">
        <input placeholder="Search leads…" disabled />
      </div>
      <div className="right">
        <span className="pill">LinkedIn connected</span>
        <button className="btn ghost sm" onClick={signOut}>
          Sign out
        </button>
        <span className="avatar">me</span>
      </div>
    </header>
  );
}
