import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/** GET /api/settings — current user config + account status. */
export async function GET() {
  try {
    await requireUserId();
    const supabase = createSupabaseServerClient();
    const [{ data: profile }, { data: account }] = await Promise.all([
      supabase
        .from('users')
        .select(
          'timezone, dms_start_cap, dms_max_cap, ramp_per_week, working_start_hour, working_end_hour, value_prop, openrouter_model'
        )
        .maybeSingle(),
      supabase
        .from('linkedin_accounts')
        .select('status, proxy_country, last_validated')
        .maybeSingle(),
    ]);
    return json({ profile: profile ?? {}, account: account ?? null });
  } catch (err) {
    return errorResponse(err);
  }
}

/** PATCH /api/settings — update per-user config (caps, hours, value-prop, model). */
export async function PATCH(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const update: Record<string, unknown> = {};

    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : undefined);

    if (typeof b.timezone === 'string' && b.timezone.trim()) update.timezone = b.timezone.trim();
    if (num(b.dms_start_cap) !== undefined) update.dms_start_cap = Math.max(1, num(b.dms_start_cap)!);
    if (num(b.dms_max_cap) !== undefined) update.dms_max_cap = Math.max(1, num(b.dms_max_cap)!);
    if (num(b.ramp_per_week) !== undefined) update.ramp_per_week = Math.max(0, num(b.ramp_per_week)!);
    if (num(b.working_start_hour) !== undefined)
      update.working_start_hour = Math.min(23, Math.max(0, num(b.working_start_hour)!));
    if (num(b.working_end_hour) !== undefined)
      update.working_end_hour = Math.min(24, Math.max(1, num(b.working_end_hour)!));
    if (typeof b.value_prop === 'string') update.value_prop = b.value_prop.slice(0, 2000);
    if (typeof b.openrouter_model === 'string') update.openrouter_model = b.openrouter_model.trim().slice(0, 120);

    if (Object.keys(update).length === 0) throw new HttpError(400, 'Nothing to update.');
    if (
      update.dms_max_cap !== undefined &&
      update.dms_start_cap !== undefined &&
      (update.dms_max_cap as number) < (update.dms_start_cap as number)
    ) {
      throw new HttpError(400, 'Max cap must be >= start cap.');
    }

    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from('users').update(update).eq('id', userId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
