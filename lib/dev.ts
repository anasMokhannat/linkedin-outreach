/**
 * Dev-only login bypass. Lets you use the app without configuring any external
 * auth provider (LinkedIn/Google). It creates a real Supabase user + session, so
 * RLS and per-user ownership keep working exactly as in production.
 *
 * GATED: only active when NEXT_PUBLIC_DEV_AUTH === 'true'. Never enable in prod.
 *
 * These are throwaway local credentials — not secrets.
 */
export const DEV_AUTH_ENABLED = process.env.NEXT_PUBLIC_DEV_AUTH === 'true';

export const DEV_USER = {
  email: 'dev@local.test',
  password: 'dev-password-12345',
};
