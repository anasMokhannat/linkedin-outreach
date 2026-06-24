import { json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { DEV_AUTH_ENABLED, DEV_USER } from '@/lib/dev';

export const runtime = 'nodejs';

/**
 * POST /api/dev/login — ensures the dev user exists and is email-confirmed, so
 * the client can immediately sign in with password. Dev-only.
 *
 * Returns 404 unless NEXT_PUBLIC_DEV_AUTH === 'true'.
 */
export async function POST() {
  if (!DEV_AUTH_ENABLED) return json({ error: 'not found' }, 404);

  const svc = createSupabaseServiceClient();

  // Create the user (idempotent). email_confirm avoids the confirmation email.
  const { error } = await svc.auth.admin.createUser({
    email: DEV_USER.email,
    password: DEV_USER.password,
    email_confirm: true,
  });

  // "already registered" is fine; surface anything else.
  if (error && !/already.*registered|exists/i.test(error.message)) {
    return json({ error: error.message }, 500);
  }

  return json({ ok: true });
}
