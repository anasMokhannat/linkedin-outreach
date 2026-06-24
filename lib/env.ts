/**
 * Centralized environment access. Server-only secrets are read lazily so that
 * importing this module from a client component never crashes the build — the
 * getters throw only when a secret is actually used server-side.
 *
 * NEVER reference SUPABASE_SERVICE_ROLE_KEY, COOKIE_ENC_KEY, APIFY_TOKEN,
 * OPENROUTER_API_KEY, CRON_SECRET, or APIFY_WEBHOOK_SECRET from client code.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

// --- Public (safe to expose to the browser) ---
export const publicEnv = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  appBaseUrl: () => optional('APP_BASE_URL', 'http://localhost:3000'),
};

// --- Server-only ---
export const serverEnv = {
  supabaseServiceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY'),
  cookieEncKey: () => required('COOKIE_ENC_KEY'),

  apifyToken: () => required('APIFY_TOKEN'),
  apifyWebhookSecret: () => required('APIFY_WEBHOOK_SECRET'),

  // Actor IDs are CONFIG, never hardcoded constants (spec §5, hard rules).
  actorConnections: () => required('APIFY_ACTOR_CONNECTIONS'),
  actorProfile: () => required('APIFY_ACTOR_PROFILE'),
  actorPosts: () => required('APIFY_ACTOR_POSTS'),
  actorCompany: () => optional('APIFY_ACTOR_COMPANY'),
  actorSendDm: () => required('APIFY_ACTOR_SEND_DM'),

  openRouterApiKey: () => required('OPENROUTER_API_KEY'),
  openRouterModel: () => optional('OPENROUTER_MODEL', 'openai/gpt-4o-mini'),

  cronSecret: () => required('CRON_SECRET'),
  qstashToken: () => optional('QSTASH_TOKEN'),
};
