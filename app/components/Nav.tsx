'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/connections', label: 'Connections' },
  { href: '/leads', label: 'Leads' },
  { href: '/messages', label: 'Messages' },
  { href: '/settings', label: 'Settings' },
];

export default function Nav() {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <nav className="nav">
      <span className="brand">LinkedIn Outreach</span>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href} className={pathname?.startsWith(l.href) ? 'active' : ''}>
          {l.label}
        </Link>
      ))}
      <button className="btn ghost" onClick={signOut} style={{ marginLeft: 'auto' }}>
        Sign out
      </button>
    </nav>
  );
}
