import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getUserId, getAccountId } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Entry router: no app session -> login; signed in with LinkedIn -> dashboard;
 * signed in without LinkedIn -> connect (unless they chose "Skip for now").
 */
export default async function Home() {
  const userId = await getUserId();
  if (!userId) redirect('/login');
  const accountId = await getAccountId();
  if (accountId) redirect('/dashboard');
  const skipped = cookies().get('fl_skip_connect')?.value;
  if (skipped) redirect('/dashboard');
  redirect('/connect');
}
