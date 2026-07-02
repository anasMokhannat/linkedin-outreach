import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/offers — the user's reusable offers (for campaigns + generation). */
export async function GET() {
  try {
    const userId = await requireUserId();
    const svc = createSupabaseServiceClient();
    const { data, error } = await svc
      .from('offers')
      .select('id, name, description, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    return json({ offers: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}

/** POST /api/offers { name, description } — create an offer. */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireUserId();
    const b = (await req.json().catch(() => ({}))) as { name?: unknown; description?: unknown };
    const name = typeof b.name === 'string' ? b.name.trim() : '';
    const description = typeof b.description === 'string' ? b.description.trim() : '';
    if (!name) throw new HttpError(400, 'Offer name is required.');

    const svc = createSupabaseServiceClient();
    const { data, error } = await svc
      .from('offers')
      .insert({ user_id: userId, name: name.slice(0, 200), description: description.slice(0, 4000) || null })
      .select('id, name, description, created_at')
      .single();
    if (error || !data) throw new Error(error?.message ?? 'Failed to create offer.');
    return json({ ok: true, offer: data });
  } catch (err) {
    return errorResponse(err);
  }
}
