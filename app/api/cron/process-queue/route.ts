import { type NextRequest } from 'next/server';
import { json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';
import { serverEnv } from '@/lib/env';
import { readCookie } from '@/lib/vault';
import { startActorRun, residentialProxy } from '@/lib/apify';
import { capStatus, DEFAULT_CAP_CONFIG } from '@/lib/caps';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/cron/process-queue — Vercel Cron (~every 15 min).
 *
 * Paces delivery; it never decides WHAT to send (the user did that at Gate 3).
 * For each due `pending` queue item it:
 *   - skips users whose account is not `connected` (needs_reauth pauses delivery)
 *   - re-checks the daily cap as a safety net (send-time already bounded it)
 *   - decrypts the cookie just-in-time and starts the Send DM actor (async)
 * The webhook finalizes each run (sent / retry / fail / needs_reauth).
 *
 * Protected by CRON_SECRET (spec §10).
 */
export async function GET(req: NextRequest) {
  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` when configured.
  const auth = req.headers.get('authorization');
  const expected = `Bearer ${serverEnv.cronSecret()}`;
  if (auth !== expected) {
    return json({ error: 'unauthorized' }, 401);
  }

  const svc = createSupabaseServiceClient();
  const nowIso = new Date().toISOString();

  // Pull a bounded batch of due items across all users.
  const { data: due, error } = await svc
    .from('send_queue')
    .select('id, user_id, message_id, scheduled_for')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .order('scheduled_for', { ascending: true })
    .limit(100);
  if (error) return json({ error: error.message }, 500);

  const today = new Date().toISOString().slice(0, 10);
  let dispatched = 0;
  let skipped = 0;

  // Cache per-user gating decisions within this tick.
  const userCache = new Map<
    string,
    { ok: boolean; liSecretId: string | null; proxyCountry: string | null; remaining: number }
  >();

  for (const item of due ?? []) {
    let gate = userCache.get(item.user_id);
    if (!gate) {
      const { data: account } = await svc
        .from('linkedin_accounts')
        .select('status, created_at, li_secret_id, proxy_country')
        .eq('user_id', item.user_id)
        .maybeSingle();
      const { data: profile } = await svc
        .from('users')
        .select('dms_start_cap, dms_max_cap, ramp_per_week')
        .eq('id', item.user_id)
        .maybeSingle();
      const { data: usage } = await svc
        .from('daily_usage')
        .select('dms_sent')
        .eq('user_id', item.user_id)
        .eq('day', today)
        .maybeSingle();

      const connected = account?.status === 'connected' && !!account.li_secret_id;
      const ageDays = account?.created_at
        ? Math.floor((Date.now() - new Date(account.created_at).getTime()) / 86_400_000)
        : 0;
      const caps = capStatus(ageDays, usage?.dms_sent ?? 0, {
        startCap: profile?.dms_start_cap ?? DEFAULT_CAP_CONFIG.startCap,
        maxCap: profile?.dms_max_cap ?? DEFAULT_CAP_CONFIG.maxCap,
        rampPerWeek: profile?.ramp_per_week ?? DEFAULT_CAP_CONFIG.rampPerWeek,
      });
      gate = {
        ok: connected,
        liSecretId: account?.li_secret_id ?? null,
        proxyCountry: account?.proxy_country ?? null,
        remaining: caps.remaining,
      };
      userCache.set(item.user_id, gate);
    }

    if (!gate.ok || gate.remaining <= 0) {
      skipped++;
      continue; // leave pending (paused or cap reached)
    }

    // Claim the item: only proceed if it is still pending.
    const { data: claimed } = await svc
      .from('send_queue')
      .update({ status: 'processing' })
      .eq('id', item.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (!claimed) {
      skipped++;
      continue; // someone else took it
    }

    try {
      const { data: message } = await svc
        .from('messages')
        .select('body, lead_id, status, leads(profile_url)')
        .eq('id', item.message_id)
        .maybeSingle();

      // Guard against state drift (e.g. rejected after queueing).
      if (!message || message.status !== 'queued') {
        await svc.from('send_queue').update({ status: 'failed' }).eq('id', item.id);
        skipped++;
        continue;
      }

      const profileUrl = (message.leads as { profile_url?: string } | null)?.profile_url;
      const liAt = await readCookie(gate.liSecretId!);

      const run = await startActorRun('sendDm', {
        input: {
          // TODO(confirm): exact input schema of APIFY_ACTOR_SEND_DM.
          cookie: [{ name: 'li_at', value: liAt, domain: '.linkedin.com' }],
          li_at: liAt,
          profileUrl,
          message: message.body,
          proxy: residentialProxy(gate.proxyCountry),
        },
        proxyCountry: gate.proxyCountry,
        webhookPayload: {
          userId: item.user_id,
          action: 'send_dm',
          messageId: item.message_id,
          queueId: item.id,
        },
      });

      await svc
        .from('send_queue')
        .update({ apify_run_id: run.runId })
        .eq('id', item.id);

      gate.remaining -= 1; // optimistically reserve cap room within this tick
      dispatched++;
    } catch (err) {
      // Return to pending for a later retry; do not lose the item.
      await svc
        .from('send_queue')
        .update({ status: 'pending' })
        .eq('id', item.id);
      await svc.from('send_log').insert({
        user_id: item.user_id,
        message_id: item.message_id,
        event: 'dispatch_error',
        detail: { message: err instanceof Error ? err.message : 'unknown' },
      });
      skipped++;
    }
  }

  return json({ ok: true, dispatched, skipped, considered: due?.length ?? 0 });
}
