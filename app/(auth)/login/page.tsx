import { redirect } from 'next/navigation';
import { getUserId } from '@/lib/auth';
import AuthForm from '../AuthForm';

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getUserId()) redirect('/');
  return <AuthForm mode="login" />;
}
