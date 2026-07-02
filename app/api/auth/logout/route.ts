import { NextResponse } from 'next/server';
import { USER_COOKIE } from '@/lib/session';

export const runtime = 'nodejs';

/**
 * POST /api/auth/logout — sign out of the app only. Clears the user session
 * cookie; the LinkedIn (Unipile) connection is left intact and reappears on the
 * next login.
 */
export async function POST() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(USER_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}
