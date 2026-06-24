import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from './env';

/**
 * Per-request Supabase client bound to the user's session cookies. Subject to RLS,
 * so it can only read/write rows owned by the authenticated user. Use this in
 * route handlers and server components for anything acting *as the user*.
 */
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a Server Component where cookies are read-only — safe to ignore;
          // session refresh is handled by middleware.
        }
      },
    },
  });
}

/**
 * Service-role client. BYPASSES RLS — server-only, used by background jobs
 * (cron, webhooks). Every query MUST filter by user_id explicitly in code
 * (spec hard rule). Never import this into client code or expose the key.
 */
export function createSupabaseServiceClient() {
  return createClient(publicEnv.supabaseUrl(), serverEnv.supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
