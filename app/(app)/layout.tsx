import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Nav from '@/app/components/Nav';
import Topbar from '@/app/components/Topbar';
import { getAccountId } from '@/lib/auth';

/**
 * Authenticated shell. Identity = connected LinkedIn account; if there's no
 * valid session cookie, send the visitor to the connect page (/).
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const accountId = await getAccountId();
  if (!accountId) redirect('/');

  return (
    <>
      <Topbar />
      <div className="shell">
        <Nav />
        <main className="app-main">{children}</main>
      </div>
    </>
  );
}
