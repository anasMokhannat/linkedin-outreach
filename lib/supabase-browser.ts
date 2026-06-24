'use client';

import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser Supabase client. Uses the anon key and is always constrained by RLS.
 * Never has access to the service role key or any LinkedIn cookie material.
 *
 * NOTE: NEXT_PUBLIC_* vars must be referenced as STATIC literals here so Next.js
 * inlines them into the client bundle. A dynamic lookup (process.env[name])
 * is NOT inlined and would be undefined in the browser.
 */
export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      'Supabase public env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and restart the dev server.'
    );
  }
  return createBrowserClient(url, anonKey);
}
