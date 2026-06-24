'use client';

import { createBrowserClient } from '@supabase/ssr';
import { publicEnv } from './env';

/**
 * Browser Supabase client. Uses the anon key and is always constrained by RLS.
 * Never has access to the service role key or any LinkedIn cookie material.
 */
export function createSupabaseBrowserClient() {
  return createBrowserClient(publicEnv.supabaseUrl(), publicEnv.supabaseAnonKey());
}
