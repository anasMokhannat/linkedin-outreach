import { type NextRequest, NextResponse } from 'next/server';
import { HttpError } from '@/lib/auth';
import { errorResponse } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { verifyPassword } from '@/lib/password';
import { signSession, USER_COOKIE, sessionCookieOptions } from '@/lib/session';

export const runtime = 'nodejs';

/** POST /api/auth/login { email, password } — verify credentials + sign in. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { email?: unknown; password?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) throw new HttpError(400, 'Email and password are required.');

    const svc = createSupabaseServiceClient();
    const { data: user } = await svc
      .from('users')
      .select('id, password_hash')
      .ilike('email', email)
      .maybeSingle();

    // Same message either way so we don't leak which emails exist.
    if (!user || !verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password.');
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(USER_COOKIE, signSession(user.id), sessionCookieOptions());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
