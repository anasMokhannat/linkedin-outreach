/**
 * Centralized environment access. Server-only secrets are read lazily so that
 * importing this module from a client component never crashes the build — the
 * getters throw only when a secret is actually used server-side.
 *
 * NEVER reference SUPABASE_SERVICE_ROLE_KEY, UNIPILE_API_KEY, or OPENROUTER_API_KEY
 * from client code.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

// --- Public ---
export const publicEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  appBaseUrl: () => optional('APP_BASE_URL', 'http://localhost:3000'),
};

// --- Server-only ---
export const serverEnv = {
  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),

  // Unipile (managed LinkedIn API). DSN is the full base URL from the Unipile
  // dashboard, e.g. https://api8.unipile.com:13443 (scheme optional).
  unipileDsn: () => required('UNIPILE_DSN'),
  unipileApiKey: () => required('UNIPILE_API_KEY'),

  openRouterApiKey: () => required('OPENROUTER_API_KEY'),
  openRouterModel: () => optional('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),
};
