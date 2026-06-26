import { createClient } from '@supabase/supabase-js';
import { publicEnv, serverEnv } from './env';

/**
 * Service-role Supabase client. BYPASSES RLS — server-only. Since identity is a
 * signed session cookie (not Supabase Auth), all access goes through this client
 * and MUST filter by account_id explicitly in code. Never import into client code.
 */
export function createSupabaseServiceClient() {
  return createClient(publicEnv.supabaseUrl(), serverEnv.supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
