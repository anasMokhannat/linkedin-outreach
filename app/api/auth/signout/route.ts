import { NextResponse } from 'next/server';
import { SESSION_COOKIE } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/auth/signout — clears the session cookie (ends the browser session).
 * The LinkedIn account stays connected on Unipile; use "Link my account" to resume.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
