import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Nav from '@/app/components/Nav';
import { getSessionUser } from '@/lib/auth';

/**
 * Layout for all authenticated app pages (dashboard, connections, leads,
 * messages, settings). Middleware already redirects unauthenticated users;
 * this is a defense-in-depth server check.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  return (
    <>
      <Nav />
      <div className="container">{children}</div>
    </>
  );
}
