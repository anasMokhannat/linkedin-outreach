import 'server-only';
import { serverEnv } from './env';
import { publicEnv } from './env';

/**
 * Typed Apify REST wrapper. Actor IDs are read from env (config, not constants).
 *
 * Async-only: we START runs and register a webhook back to /api/webhooks/apify.
 * We NEVER long-poll a run to completion inside a Vercel function (spec hard rule).
 */

const APIFY_BASE = 'https://api.apify.com/v2';

export type ApifyActorKey =
  | 'connections'
  | 'profile'
  | 'posts'
  | 'company'
  | 'sendDm';

export function resolveActorId(key: ApifyActorKey): string {
  switch (key) {
    case 'connections':
      return serverEnv.actorConnections();
    case 'profile':
      return serverEnv.actorProfile();
    case 'posts':
      return serverEnv.actorPosts();
    case 'company':
      return serverEnv.actorCompany();
    case 'sendDm':
      return serverEnv.actorSendDm();
  }
}

export interface StartRunOptions {
  /** Actor input payload. For cookie-based actors include the session + proxy. */
  input: Record<string, unknown>;
  /** Opaque correlation data echoed back to us on the webhook. */
  webhookPayload: Record<string, unknown>;
  /** Apify proxy config; cookie-based actors should pin residential + country. */
  proxyCountry?: string | null;
}

export interface ApifyRunRef {
  runId: string;
  defaultDatasetId: string | null;
}

function webhookUrl(): string {
  return `${publicEnv.appBaseUrl()}/api/webhooks/apify`;
}

/**
 * Start an actor run with an ad-hoc webhook subscribed to terminal statuses.
 * The webhook secret is passed both as a header (via Apify's `headersTemplate`)
 * and inside the payload so the receiver can verify authenticity.
 */
export async function startActorRun(
  key: ApifyActorKey,
  opts: StartRunOptions
): Promise<ApifyRunRef> {
  const actorId = resolveActorId(key);
  if (!actorId) throw new Error(`Actor id not configured for "${key}"`);

  const webhooks = [
    {
      eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED', 'ACTOR.RUN.ABORTED', 'ACTOR.RUN.TIMED_OUT'],
      requestUrl: webhookUrl(),
      headersTemplate: JSON.stringify({ 'x-apify-webhook-secret': serverEnv.apifyWebhookSecret() }),
      payloadTemplate: JSON.stringify({
        secret: serverEnv.apifyWebhookSecret(),
        actorKey: key,
        eventType: '{{eventType}}',
        runId: '{{resource.id}}',
        datasetId: '{{resource.defaultDatasetId}}',
        status: '{{resource.status}}',
        correlation: opts.webhookPayload,
      }),
    },
  ];
  const encodedWebhooks = Buffer.from(JSON.stringify(webhooks)).toString('base64');

  const url = new URL(`${APIFY_BASE}/acts/${encodeURIComponent(actorId)}/runs`);
  url.searchParams.set('token', serverEnv.apifyToken());
  url.searchParams.set('webhooks', encodedWebhooks);

  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(opts.input),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify start run failed (${res.status}): ${text}`);
  }
  const json = (await res.json()) as { data: { id: string; defaultDatasetId?: string } };
  return { runId: json.data.id, defaultDatasetId: json.data.defaultDatasetId ?? null };
}

/** Read dataset items for a finished run (called from the webhook handler). */
export async function getDatasetItems<T = Record<string, unknown>>(
  datasetId: string
): Promise<T[]> {
  const url = new URL(`${APIFY_BASE}/datasets/${encodeURIComponent(datasetId)}/items`);
  url.searchParams.set('token', serverEnv.apifyToken());
  url.searchParams.set('clean', 'true');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Apify dataset read failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T[];
}

/** Standard residential-proxy config for cookie-based actors, geo-matched. */
export function residentialProxy(country?: string | null) {
  return {
    useApifyProxy: true,
    apifyProxyGroups: ['RESIDENTIAL'],
    ...(country ? { apifyProxyCountry: country } : {}),
  };
}

/**
 * Heuristic detection of a LinkedIn auth failure from a finished actor run.
 * When true the account should be flipped to `needs_reauth` (spec §1, §9).
 */
export function looksLikeAuthFailure(status: string, items: unknown[]): boolean {
  if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
    // A cookie-based run that produced nothing is a strong reauth signal.
    if (!items || items.length === 0) return true;
  }
  const blob = JSON.stringify(items ?? []).toLowerCase();
  return (
    blob.includes('not logged in') ||
    blob.includes('authwall') ||
    blob.includes('session expired') ||
    blob.includes('login required') ||
    blob.includes('checkpoint')
  );
}
