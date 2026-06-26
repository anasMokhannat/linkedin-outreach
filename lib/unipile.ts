import 'server-only';
import { serverEnv } from './env';
import { log } from './log';
import type { StagedConnection } from './types';

/**
 * Typed Unipile REST client. Unipile is a managed provider that holds the
 * LinkedIn session on its side; we authenticate with an account-wide API key
 * (X-API-KEY) and reference a per-user `account_id`.
 *
 * Base URL is the DSN from the Unipile dashboard (e.g. https://api8.unipile.com:13443).
 * All endpoints live under /api/v1.
 */

function base(): string {
  // The dashboard DSN may be given without a scheme (e.g. "api46.unipile.com:17696").
  // fetch() needs an absolute URL, so default to https:// when none is present.
  const dsn = serverEnv.unipileDsn().trim().replace(/\/+$/, '');
  return /^https?:\/\//i.test(dsn) ? dsn : `https://${dsn}`;
}

function jsonHeaders(): Record<string, string> {
  return {
    'X-API-KEY': serverEnv.unipileApiKey(),
    'content-type': 'application/json',
    accept: 'application/json',
  };
}

/**
 * fetch wrapper that logs method, path (query stripped), status and duration to
 * the server console. The X-API-KEY lives in headers and is never logged.
 */
async function uFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = init?.method ?? 'GET';
  const path = url.replace(base(), '').split('?')[0];
  const started = Date.now();
  try {
    const res = await globalThis.fetch(url, init);
    const line = `${method} ${path} -> ${res.status} (${Date.now() - started}ms)`;
    if (res.ok) log.info('unipile', line);
    else log.warn('unipile', line);
    return res;
  } catch (e) {
    log.error('unipile', `${method} ${path} threw (${Date.now() - started}ms)`, {
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

async function parseError(res: Response): Promise<string> {
  const text = await res.text();
  try {
    const j = JSON.parse(text);
    return j.detail || j.message || j.title || text;
  } catch {
    return text;
  }
}

export interface UnipileConnectResult {
  accountId: string;
  /** Set when LinkedIn requires a checkpoint (2FA/OTP/captcha) to finish. */
  checkpoint?: string;
}

function readCheckpoint(data: Record<string, any>): string {
  const c = data.checkpoint;
  if (typeof c === 'string') return c;
  return c?.type ?? data.checkpoint_type ?? data.type ?? 'CHECKPOINT';
}

function readAccountId(data: Record<string, any>): string | undefined {
  return (
    data.account_id ??
    data.checkpoint?.account_id ??
    (data.object === 'Account' || data.object === 'AccountCreated' ? data.id : undefined) ??
    undefined
  );
}

/**
 * Interpret a POST /accounts (or /checkpoint) response. Detects a checkpoint
 * regardless of exact status code / field nesting, extracts the account id from
 * its various locations, and logs the raw shape for debugging.
 */
function interpretAccountResponse(
  op: string,
  status: number,
  ok: boolean,
  data: Record<string, any>
): UnipileConnectResult {
  const accountId = readAccountId(data);
  const hasCheckpoint =
    status === 202 ||
    data.object === 'Checkpoint' ||
    !!data.checkpoint ||
    !!data.checkpoint_type;

  log.info('unipile', `${op} response`, {
    status,
    object: data.object,
    hasCheckpoint,
    checkpointType: hasCheckpoint ? readCheckpoint(data) : undefined,
    hasAccountId: !!accountId,
    keys: Object.keys(data).slice(0, 12),
  });

  if (hasCheckpoint) {
    return { accountId: accountId ?? '', checkpoint: readCheckpoint(data) };
  }
  if (!ok || !accountId) throw connectError(status, data);
  return { accountId };
}

/** Error carrying Unipile's HTTP status + machine type so routes can map it cleanly. */
export class UnipileError extends Error {
  constructor(
    public status: number,
    public type: string,
    message: string
  ) {
    super(message);
    this.name = 'UnipileError';
  }
}

function connectError(status: number, data: Record<string, any>): UnipileError {
  const detail = data.detail || data.message || data.title || `HTTP ${status}`;
  const type = data.type ?? '';
  log.warn('unipile', 'account error', { status, type, detail });
  return new UnipileError(status, type, detail);
}

/** Connect a LinkedIn account from a li_at cookie. */
export async function unipileConnectWithCookie(
  liAt: string,
  country?: string | null
): Promise<UnipileConnectResult> {
  const res = await uFetch(`${base()}/api/v1/accounts`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ provider: 'LINKEDIN', access_token: liAt, ...(country ? { country } : {}) }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return interpretAccountResponse('cookie connect', res.status, res.ok, data);
}

/**
 * Connect a LinkedIn account with username (email/phone) + password. Unipile logs
 * in server-side through its own browser/proxy, so no Unipile UI is shown to the
 * user. A 202 means LinkedIn issued a checkpoint to resolve with the code via
 * unipileSolveCheckpoint.
 */
export async function unipileConnectWithCredentials(
  username: string,
  password: string,
  country?: string | null
): Promise<UnipileConnectResult> {
  const res = await uFetch(`${base()}/api/v1/accounts`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ provider: 'LINKEDIN', username, password, ...(country ? { country } : {}) }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  return interpretAccountResponse('credentials connect', res.status, res.ok, data);
}

/** Solve a connection checkpoint by submitting the 2FA/OTP code. */
export async function unipileSolveCheckpoint(
  accountId: string,
  code: string
): Promise<UnipileConnectResult> {
  const res = await uFetch(`${base()}/api/v1/accounts/checkpoint`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ account_id: accountId, provider: 'LINKEDIN', code }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, any>;
  const result = interpretAccountResponse('checkpoint solve', res.status, res.ok, data);
  // Keep the original account id if the solve response omits it.
  return { accountId: result.accountId || accountId, checkpoint: result.checkpoint };
}

export interface UnipileRelation {
  member_id: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  public_identifier?: string;
  public_profile_url?: string;
}

/**
 * One page of relations, with a short retry on transient failures. Right after
 * connecting, LinkedIn sessions can briefly report 401 "disconnected" or rate
 * limit (429) while Unipile finishes its initial sync, then recover — so we
 * retry those a couple of times before giving up.
 */
async function listRelationsPage(
  accountId: string,
  cursor?: string,
  limit = 200
): Promise<{ items: UnipileRelation[]; cursor: string | null }> {
  const url = new URL(`${base()}/api/v1/users/relations`);
  url.searchParams.set('account_id', accountId);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);

  const transient = new Set([401, 429, 500, 502, 503, 504]);
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await uFetch(url.toString(), { headers: jsonHeaders() });
    if (res.ok) {
      const data = (await res.json()) as { items?: UnipileRelation[]; cursor?: string | null };
      return { items: data.items ?? [], cursor: data.cursor ?? null };
    }
    lastErr = `Unipile relations failed (${res.status}): ${await parseError(res)}`;
    log.warn('unipile', `relations attempt ${attempt + 1} failed`, { status: res.status });
    if (!transient.has(res.status) || attempt === 2) break;
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
  }
  throw new Error(lastErr);
}

/** Map a Unipile relation to our transient StagedConnection. */
export function relationToStaged(r: UnipileRelation): StagedConnection {
  const profileUrl =
    r.public_profile_url ||
    (r.public_identifier ? `https://www.linkedin.com/in/${r.public_identifier}` : '');
  return {
    profileUrl,
    fullName: [r.first_name, r.last_name].filter(Boolean).join(' ') || profileUrl,
    firstName: r.first_name,
    lastName: r.last_name,
    headline: r.headline,
    providerId: r.member_id, // attendee id used to message them later
  };
}

/**
 * Fetch all 1st-degree relations, paging until the cursor is exhausted.
 * Bounded by maxPages to avoid runaway loops.
 */
export async function unipileListAllRelations(
  accountId: string,
  maxPages = 50
): Promise<StagedConnection[]> {
  const out: StagedConnection[] = [];
  let cursor: string | null | undefined;
  for (let page = 0; page < maxPages; page++) {
    const { items, cursor: next } = await listRelationsPage(accountId, cursor ?? undefined);
    for (const r of items) {
      const staged = relationToStaged(r);
      if (staged.profileUrl) out.push(staged);
    }
    if (!next) break;
    cursor = next;
  }
  log.info('unipile', 'relations fetched', { count: out.length });
  return out;
}

/** Derive the identifier Unipile expects from a stored member id or profile URL. */
export function deriveIdentifier(providerMemberId?: string | null, profileUrl?: string | null): string | null {
  if (providerMemberId) return providerMemberId;
  if (profileUrl) {
    const m = profileUrl.match(/\/in\/([^/?#]+)/i);
    if (m) return decodeURIComponent(m[1]);
  }
  return null;
}

export interface UnipileExperience {
  title?: string;
  company?: string;
  location?: string;
  start?: string;
  end?: string;
  current?: boolean;
  description?: string;
}
export interface UnipileEducation {
  school?: string;
  degree?: string;
  field?: string;
  start?: string;
  end?: string;
}
export interface UnipileProfile {
  name?: string | null;
  currentCompany?: string | null;
  currentTitle?: string | null;
  location?: string | null;
  school?: string | null;
  industry?: string | null;
  headline?: string | null;
  summary?: string | null;
  companyAbout?: string | null;
  experiences: UnipileExperience[];
  education: UnipileEducation[];
  skills: string[];
  connectionsCount?: number | null;
  raw: unknown;
}

/** Retrieve the full LinkedIn profile by identifier (member id or public id). */
export async function unipileGetProfile(
  accountId: string,
  identifier: string
): Promise<UnipileProfile> {
  const url = new URL(`${base()}/api/v1/users/${encodeURIComponent(identifier)}`);
  url.searchParams.set('account_id', accountId);
  const res = await uFetch(url.toString(), { headers: jsonHeaders() });
  if (!res.ok) throw new Error(`Unipile profile failed (${res.status}): ${await parseError(res)}`);

  const p = (await res.json()) as Record<string, any>;
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof p[k] === 'string' && p[k].trim()) return p[k] as string;
    return undefined;
  };

  const rawExp = (p.work_experience ?? p.experience ?? p.experiences ?? []) as any[];
  const experiences: UnipileExperience[] = (Array.isArray(rawExp) ? rawExp : []).map((e) => ({
    title: e.position ?? e.title ?? e.role,
    company: e.company ?? e.companyName ?? e.company_name,
    location: e.location,
    start: e.start ?? e.start_date ?? e.from,
    end: e.end ?? e.end_date ?? e.to,
    current: !!e.current,
    description: e.description,
  }));
  const current = experiences.find((e) => e.current) ?? experiences[0];

  const rawEdu = (p.education ?? p.educations ?? p.schools ?? []) as any[];
  const education: UnipileEducation[] = (Array.isArray(rawEdu) ? rawEdu : []).map((e) => ({
    school: e.school ?? e.schoolName ?? e.name,
    degree: e.degree,
    field: e.field_of_study ?? e.field,
    start: e.start ?? e.start_date,
    end: e.end ?? e.end_date,
  }));

  const rawSkills = (p.skills ?? []) as any[];
  const skills: string[] = (Array.isArray(rawSkills) ? rawSkills : [])
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter((s): s is string => !!s);

  return {
    name: pick('name', 'full_name') ?? ([pick('first_name'), pick('last_name')].filter(Boolean).join(' ') || null),
    headline: pick('headline', 'occupation') ?? null,
    location: pick('location', 'location_name') ?? null,
    summary: pick('summary', 'about') ?? null,
    currentTitle: current?.title ?? null,
    currentCompany: current?.company ?? null,
    school: education[0]?.school ?? null,
    industry: pick('industry') ?? null,
    companyAbout: null,
    experiences,
    education,
    skills,
    connectionsCount: typeof p.connections_count === 'number' ? p.connections_count : null,
    raw: p,
  };
}

export interface UnipilePost {
  text: string;
  url?: string;
  likes?: number;
}

/** Retrieve a user's recent posts. */
export async function unipileGetPosts(
  accountId: string,
  identifier: string,
  limit = 5
): Promise<UnipilePost[]> {
  const url = new URL(`${base()}/api/v1/users/${encodeURIComponent(identifier)}/posts`);
  url.searchParams.set('account_id', accountId);
  url.searchParams.set('limit', String(limit));
  const res = await uFetch(url.toString(), { headers: jsonHeaders() });
  if (!res.ok) {
    // Posts can be unavailable for some profiles; treat as non-fatal.
    return [];
  }
  const data = (await res.json()) as {
    items?: Array<{ text?: string; share_url?: string; reaction_counter?: number }>;
  };
  return (data.items ?? [])
    .filter((it) => it.text)
    .map((it) => ({
      text: it.text!.length > 600 ? it.text!.slice(0, 600) : it.text!,
      url: it.share_url,
      likes: typeof it.reaction_counter === 'number' ? it.reaction_counter : undefined,
    }));
}

/**
 * Find the most recently connected, usable LinkedIn account on the Unipile
 * workspace. Lets a user link an account they connected outside our connect
 * route (e.g. via the Unipile dashboard). Returns the newest OK account.
 */
export async function unipileFindLatestLinkedInAccount(): Promise<{ accountId: string } | null> {
  const res = await uFetch(`${base()}/api/v1/accounts`, { headers: jsonHeaders() });
  if (!res.ok) throw new Error(`Unipile accounts failed (${res.status}): ${await parseError(res)}`);
  const data = (await res.json()) as {
    items?: Array<{ id: string; type?: string; created_at?: string; sources?: Array<{ status?: string }> }>;
  };
  const linkedin = (data.items ?? [])
    .filter((a) => (a.type ?? '').toUpperCase() === 'LINKEDIN')
    .filter((a) =>
      (a.sources ?? []).some((s) => ['OK', 'CONNECTED'].includes((s.status ?? '').toUpperCase()))
    )
    .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  log.info('unipile', 'find latest account', { found: linkedin.length, picked: linkedin[0]?.id });
  return linkedin.length ? { accountId: linkedin[0].id } : null;
}

export type UnipileAccountState = 'OK' | 'CONNECTING' | 'CREDENTIALS' | 'GONE' | 'UNKNOWN';

/**
 * Inspect an account's connection state. Unipile reports per-source statuses;
 * we collapse them to a single state for the UI:
 *   OK          — connected and usable
 *   CONNECTING  — session still being established (retry shortly)
 *   CREDENTIALS — credentials rejected / checkpoint (reconnect needed)
 *   GONE        — account no longer exists (connection failed and was dropped)
 */
export async function unipileGetAccountState(accountId: string): Promise<UnipileAccountState> {
  const res = await uFetch(`${base()}/api/v1/accounts/${encodeURIComponent(accountId)}`, {
    headers: jsonHeaders(),
  });
  if (res.status === 404) return 'GONE';
  if (!res.ok) return 'UNKNOWN';
  const data = (await res.json()) as { sources?: Array<{ status?: string }> };
  const statuses = (data.sources ?? []).map((s) => (s.status ?? '').toUpperCase());
  log.info('unipile', 'account state', { sources: statuses });
  if (statuses.some((s) => s === 'OK' || s === 'CONNECTED')) return 'OK';
  if (statuses.some((s) => s === 'CREDENTIALS' || s.includes('CHECKPOINT') || s.includes('ERROR')))
    return 'CREDENTIALS';
  if (statuses.some((s) => s === 'CONNECTING' || s === 'SYNCING')) return 'CONNECTING';
  return 'UNKNOWN';
}

/** Poll the account state until it settles (OK/CREDENTIALS/GONE) or attempts run out. */
export async function unipileWaitForAccount(
  accountId: string,
  attempts = 4,
  delayMs = 1200
): Promise<UnipileAccountState> {
  let state: UnipileAccountState = 'UNKNOWN';
  for (let i = 0; i < attempts; i++) {
    state = await unipileGetAccountState(accountId);
    if (state === 'OK' || state === 'CREDENTIALS' || state === 'GONE') return state;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return state; // likely still CONNECTING
}

/** Disconnect (delete) a Unipile account on their side. Best-effort. */
export async function unipileDeleteAccount(accountId: string): Promise<void> {
  await uFetch(`${base()}/api/v1/accounts/${encodeURIComponent(accountId)}`, {
    method: 'DELETE',
    headers: jsonHeaders(),
  });
}

/**
 * Detect a Unipile error string that means the LinkedIn session is no longer
 * valid (account disconnected / credentials expired) → caller should flip the
 * account to needs_reauth.
 */
export function isUnipileAuthError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('disconnect') ||
    m.includes('credential') ||
    m.includes('reconnect') ||
    m.includes('not connected') ||
    m.includes('unauthorized') ||
    m.includes('checkpoint')
  );
}

/**
 * Start a new chat (send the first DM) to a relation. attendeeId is the relation's
 * Unipile member_id. Uses multipart/form-data, which Unipile expects for chat
 * creation (it also supports attachments).
 */
export async function unipileSendNewMessage(
  accountId: string,
  attendeeId: string,
  text: string
): Promise<{ chatId?: string }> {
  const form = new FormData();
  form.append('account_id', accountId);
  form.append('attendees_ids', attendeeId);
  form.append('text', text);

  const res = await uFetch(`${base()}/api/v1/chats`, {
    method: 'POST',
    headers: { 'X-API-KEY': serverEnv.unipileApiKey(), accept: 'application/json' },
    body: form,
  });
  if (!res.ok) throw new Error(`Unipile send failed (${res.status}): ${await parseError(res)}`);
  const data = (await res.json().catch(() => ({}))) as { chat_id?: string };
  log.info('unipile', 'dm sent', { chatId: data.chat_id });
  return { chatId: data.chat_id };
}
