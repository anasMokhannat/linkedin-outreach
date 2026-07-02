import { redirect } from 'next/navigation';
import { getUserId, getAccountId } from '@/lib/auth';
import ConnectForm from './ConnectForm';

export const dynamic = 'force-dynamic';

/** Logged-in users connect a LinkedIn account here. Already connected → dashboard. */
export default async function ConnectPage() {
  const userId = await getUserId();
  if (!userId) redirect('/login');
  const accountId = await getAccountId();
  if (accountId) redirect('/dashboard');
  return <ConnectForm />;
}
