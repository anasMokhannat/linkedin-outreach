import { type NextRequest, NextResponse } from 'next/server';
import { HttpError } from '@/lib/auth';
import { errorResponse } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { hashPassword } from '@/lib/password';
import { signSession, USER_COOKIE, sessionCookieOptions } from '@/lib/session';

export const runtime = 'nodejs';

/** POST /api/auth/register { email, password, confirmPassword?, companyName } — create an app user + sign in. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      email?: unknown;
      password?: unknown;
      confirmPassword?: unknown;
      companyName?: unknown;
    };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const companyName = typeof body.companyName === 'string' ? body.companyName.trim() : '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Enter a valid email.');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    // Confirm the password when the client sends a confirmation value.
    if (typeof body.confirmPassword === 'string' && body.confirmPassword !== password) {
      throw new HttpError(400, 'Passwords do not match.');
    }
    if (!companyName) throw new HttpError(400, 'Company name is required.');

    const svc = createSupabaseServiceClient();
    const { data: existing } = await svc.from('users').select('id').ilike('email', email).maybeSingle();
    if (existing) throw new HttpError(409, 'An account with this email already exists.');

    const { data: user, error } = await svc
      .from('users')
      .insert({ email, password_hash: hashPassword(password), company_name: companyName.slice(0, 200) })
      .select('id')
      .single();
    if (error || !user) throw new Error(error?.message ?? 'Failed to create account.');

    const res = NextResponse.json({ ok: true });
    res.cookies.set(USER_COOKIE, signSession(user.id), sessionCookieOptions());
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
