import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';

export default async function Home() {
  const user = await getSessionUser();
  if (user) redirect('/dashboard');

  return (
    <main className="center-wrap">
      <div className="card auth-card" style={{ maxWidth: 520 }}>
        <h1>LinkedIn Personalized Outreach</h1>
        <p className="muted">
          Sync your 1st-degree connections, enrich the ones you select, generate personalized
          messages, then <strong>explicitly approve and send</strong> — one at a time, throttled
          to keep your account safe.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link className="btn" href="/login">
            Sign in with LinkedIn
          </Link>
        </div>
        <p className="muted" style={{ marginTop: 18, fontSize: 13 }}>
          This tool automates actions on LinkedIn using your own session and operates against
          LinkedIn&apos;s Terms of Service; it carries account-restriction risk. Sending limits are
          conservative by default.
        </p>
      </div>
    </main>
  );
}
