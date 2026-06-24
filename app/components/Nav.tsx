'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

const LINKS = [
  { href: '/dashboard', label: 'Dashboard', icon: '◧' },
  { href: '/connections', label: 'Connections', icon: '⇄' },
  { href: '/leads', label: 'Leads', icon: '◎' },
  { href: '/messages', label: 'Messages', icon: '✉' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
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
    <aside className="sidebar">
      <span className="brand">
        <span className="dot">in</span>
        Outreach
      </span>
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname?.startsWith(l.href + '/');
        return (
          <Link key={l.href} href={l.href} className={`navlink ${active ? 'active' : ''}`}>
            <span aria-hidden style={{ width: 18, textAlign: 'center' }}>
              {l.icon}
            </span>
            {l.label}
          </Link>
        );
      })}
      <div className="spacer" />
      <button className="btn ghost" onClick={signOut}>
        Sign out
      </button>
    </aside>
  );
}
