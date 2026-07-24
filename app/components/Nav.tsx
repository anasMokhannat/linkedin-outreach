'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconGrid, IconUsers, IconSettings, IconMail, IconSearch } from './icons';

const LINKS = [
  { href: '/dashboard', label: 'Overview', Icon: IconGrid },
  { href: '/connections', label: 'Connections', Icon: IconSearch },
  { href: '/leads', label: 'Leads', Icon: IconUsers },
  { href: '/inbox', label: 'Inbox', Icon: IconMail },
  { href: '/settings', label: 'Settings', Icon: IconSettings },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <div className="group">Menu</div>
      {LINKS.map(({ href, label, Icon }) => {
        const active = pathname === href || pathname?.startsWith(href + '/');
        return (
          <Link key={href} href={href} className={`navlink ${active ? 'active' : ''}`}>
            <Icon />
            {label}
          </Link>
        );
      })}
    </aside>
  );
}
