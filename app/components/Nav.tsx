'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const LINKS = [
  { href: '/dashboard', label: 'Overview', icon: '◧' },
  { href: '/leads', label: 'Leads', icon: '◎' },
  { href: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="group">Navigation</div>
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname?.startsWith(l.href + '/');
        return (
          <Link key={l.href} href={l.href} className={`navlink ${active ? 'active' : ''}`}>
            <span className="ic" aria-hidden>
              {l.icon}
            </span>
            {l.label}
          </Link>
        );
      })}
    </aside>
  );
}
