import { type NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { serverEnv } from '@/lib/env';
import { getDatasetItems, looksLikeAuthFailure } from '@/lib/apify';
import { normalizeProfile, normalizePosts } from '@/lib/normalize';

export const runtime = 'nodejs';

/**
 * POST /api/webhooks/apify — terminal-status handler for every actor run.
 *
 * Security: Apify is configured to send our secret both as a header and inside
 * the payload. We verify it before doing anything (spec §10). Requests that fail
 * verification get 401 and are ignored.
 *
 * This route is the ONLY place that turns finished runs into DB state. It runs
 * with the service role (bypasses RLS) and filters every write by user_id taken
 * from the run's correlation payload.
 */

const MAX_SEND_ATTEMPTS = 3;

interface WebhookBody {
  secret?: string;
  actorKey?: string;
  eventType?: string;
  runId?: string;
  datasetId?: string;
  status?: string;
  correlation?: {
    userId?: string;
    action?: string;
    leadId?: string;
    messageId?: string;
    queueId?: string;
    accountId?: string;
  };
}

function verify(req: NextRequest, body: WebhookBody): boolean {
  const expected = serverEnv.apifyWebhookSecret();
  const header = req.headers.get('x-apify-webhook-secret');
  // Constant-ish comparison; either channel must match the configured secret.
  return header === expected || body.secret === expected;
}

export async function POST(req: NextRequest) {
  let body: WebhookBody;
  try {
    body = (await req.json()) as WebhookBody;
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  if (!verify(req, body)) {
    return json({ error: 'unauthorized' }, 401);
  }

  const { correlation, status = '', datasetId } = body;
  const userId = correlation?.userId;
  const action = correlation?.action;
  if (!userId || !action) return json({ ok: true, skipped: 'no correlation' });

  const svc = createSupabaseServiceClient();
  const succeeded = status === 'SUCCEEDED';

  try {
    if (action === 'sync_connections') {
      await handleSync(svc, userId, succeeded, datasetId ?? null);
    } else if (action === 'enrich') {
      await handleEnrich(svc, userId, body.actorKey ?? '', correlation!.leadId ?? '', succeeded, datasetId ?? null);
    } else if (action === 'send_dm') {
      await handleSend(svc, userId, correlation!, succeeded, status, datasetId ?? null, body.runId ?? null);
    }
  } catch (err) {
    // Log but always 200 so Apify doesn't hammer retries on our internal errors.
    await svc.from('send_log').insert({
      user_id: userId,
      event: 'webhook_error',
      detail: { action, message: err instanceof Error ? err.message : 'unknown' },
    });
  }

  return json({ ok: true });
}

async function handleSync(
  svc: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  succeeded: boolean,
  datasetId: string | null
) {
  if (succeeded && datasetId) {
    // Sanity-check for an auth failure masquerading as success (empty/authwall).
    let items: unknown[] = [];
    try {
      items = await getDatasetItems(datasetId);
    } catch {
      /* dataset read can lag; treat as success pending */
    }
    if (looksLikeAuthFailure('SUCCEEDED', items) && items.length === 0) {
      await svc
        .from('linkedin_accounts')
        .update({ status: 'needs_reauth', last_sync_status: 'failed' })
        .eq('user_id', userId);
      return;
    }
    await svc
      .from('linkedin_accounts')
      .update({
        last_sync_status: 'succeeded',
        last_sync_dataset_id: datasetId,
        last_validated: new Date().toISOString(),
        status: 'connected',
      })
      .eq('user_id', userId);
  } else {
    // Failed/aborted cookie-based run → assume reauth needed (spec §1).
    await svc
      .from('linkedin_accounts')
      .update({ status: 'needs_reauth', last_sync_status: 'failed' })
      .eq('user_id', userId);
  }
}

async function handleEnrich(
  svc: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  actorKey: string,
  leadId: string,
  succeeded: boolean,
  datasetId: string | null
) {
  if (!succeeded || !datasetId || !leadId) return;
  const items = await getDatasetItems<Record<string, unknown>>(datasetId);
  if (!items.length) return;

  // Merge into the single enrichment row for this lead.
  const { data: existing } = await svc
    .from('lead_enrichment')
    .select('id, recent_posts, company, raw')
    .eq('lead_id', leadId)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    lead_id: leadId,
    user_id: userId,
    recent_posts: existing?.recent_posts ?? null,
    company: existing?.company ?? null,
    raw: (existing?.raw as Record<string, unknown>) ?? {},
  };

  const leadPatch: Record<string, unknown> = {};

  if (actorKey === 'profile') {
    const p = normalizeProfile(items[0]);
    (patch.raw as Record<string, unknown>).profile = items[0];
    if (p.currentCompany) leadPatch.current_company = p.currentCompany;
    if (p.currentTitle) leadPatch.current_title = p.currentTitle;
    if (p.location) leadPatch.location = p.location;
    if (p.school) leadPatch.school = p.school;
    if (p.industry) leadPatch.industry = p.industry;
    if (p.headline) leadPatch.headline = p.headline;
    if (p.companyAbout) patch.company = { ...(patch.company as object), about: p.companyAbout };
  } else if (actorKey === 'posts') {
    patch.recent_posts = normalizePosts(items).slice(0, 5);
    (patch.raw as Record<string, unknown>).posts = items.slice(0, 10);
  } else if (actorKey === 'company') {
    patch.company = { ...(patch.company as object), page: items[0] };
    (patch.raw as Record<string, unknown>).company = items[0];
  }

  await svc.from('lead_enrichment').upsert(patch, { onConflict: 'lead_id' });

  leadPatch.enriched_at = new Date().toISOString();
  await svc.from('leads').update(leadPatch).eq('id', leadId).eq('user_id', userId);
}

async function handleSend(
  svc: ReturnType<typeof createSupabaseServiceClient>,
  userId: string,
  correlation: NonNullable<WebhookBody['correlation']>,
  succeeded: boolean,
  status: string,
  datasetId: string | null,
  runId: string | null
) {
  const { messageId, queueId } = correlation;
  if (!messageId || !queueId) return;

  if (succeeded) {
    await svc
      .from('messages')
      .update({ status: 'sent', sent_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('user_id', userId);
    await svc.from('send_queue').update({ status: 'done' }).eq('id', queueId).eq('user_id', userId);

    // Atomic per-day increment.
    const today = new Date().toISOString().slice(0, 10);
    await svc.rpc('app_increment_daily_usage', { p_user_id: userId, p_day: today });

    await svc.from('send_log').insert({
      user_id: userId,
      message_id: messageId,
      event: 'dm_sent',
      detail: { runId },
    });
    return;
  }

  // Failure path: detect auth issues, otherwise retry/fail.
  let items: unknown[] = [];
  if (datasetId) {
    try {
      items = await getDatasetItems(datasetId);
    } catch {
      /* ignore */
    }
  }
  const authFail = looksLikeAuthFailure(status, items);

  // Bump attempts on the queue row.
  const { data: q } = await svc
    .from('send_queue')
    .select('attempts')
    .eq('id', queueId)
    .maybeSingle();
  const attempts = (q?.attempts ?? 0) + 1;

  if (authFail) {
    // Flip account and pause the user's queue (spec §9).
    await svc.from('linkedin_accounts').update({ status: 'needs_reauth' }).eq('user_id', userId);
    await svc
      .from('send_queue')
      .update({ status: 'pending', attempts }) // keep pending; cron is paused while needs_reauth
      .eq('id', queueId)
      .eq('user_id', userId);
    await svc
      .from('messages')
      .update({ status: 'queued' })
      .eq('id', messageId)
      .eq('user_id', userId);
    await svc.from('send_log').insert({
      user_id: userId,
      message_id: messageId,
      event: 'send_auth_failure',
      detail: { runId, attempts },
    });
    return;
  }

  if (attempts >= MAX_SEND_ATTEMPTS) {
    await svc.from('send_queue').update({ status: 'failed', attempts }).eq('id', queueId).eq('user_id', userId);
    await svc.from('messages').update({ status: 'failed' }).eq('id', messageId).eq('user_id', userId);
    await svc.from('send_log').insert({
      user_id: userId,
      message_id: messageId,
      event: 'send_failed',
      detail: { runId, attempts },
    });
  } else {
    // Return to pending for a later cron retry.
    await svc.from('send_queue').update({ status: 'pending', attempts }).eq('id', queueId).eq('user_id', userId);
    await svc.from('messages').update({ status: 'queued' }).eq('id', messageId).eq('user_id', userId);
    await svc.from('send_log').insert({
      user_id: userId,
      message_id: messageId,
      event: 'send_retry',
      detail: { runId, attempts },
    });
  }
}
