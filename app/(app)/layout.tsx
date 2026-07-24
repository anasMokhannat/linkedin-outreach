import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import Nav from '@/app/components/Nav';
import Topbar from '@/app/components/Topbar';
import { ConfirmProvider } from '@/app/components/ConfirmDialog';
import { getUserId, getAccountId } from '@/lib/auth';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

/**
 * Authenticated shell. Requires an app-user session. Connecting LinkedIn is
 * optional (users can skip and do it later from Settings); when it isn't
 * connected we surface a small indicator in the top bar.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const userId = await getUserId();
  if (!userId) redirect('/login');
  const accountId = await getAccountId();

  const svc = createSupabaseServiceClient();
  const { data: user } = await svc.from('users').select('email, company_name').eq('id', userId).maybeSingle();

  return (
    <ConfirmProvider>
      <Topbar
        linkedinConnected={!!accountId}
        email={user?.email ?? ''}
        companyName={user?.company_name ?? null}
      />
      <div className="shell">
        <Nav />
        <main className="app-main">{children}</main>
      </div>
    </ConfirmProvider>
  );
}
