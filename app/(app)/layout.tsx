import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Nav from '@/app/components/Nav';
import { getSessionUser } from '@/lib/auth';

/**
 * Layout for all authenticated app pages (dashboard, connections, leads,
 * messages, settings). Sidebar + full-width main content area. Middleware
 * already redirects unauthenticated users; this is a defense-in-depth check.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <div className="app-shell">
      <Nav />
      <main className="app-main">{children}</main>
    </div>
  );
}
