import { type NextRequest } from 'next/server';
import { requireUserId, HttpError } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServiceClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/** PATCH /api/offers/:id { name, description } — edit an offer. */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const b = (await req.json().catch(() => ({}))) as { name?: unknown; description?: unknown };
    const update: Record<string, unknown> = {};
    if (typeof b.name === 'string' && b.name.trim()) update.name = b.name.trim().slice(0, 200);
    if (typeof b.description === 'string') update.description = b.description.trim().slice(0, 4000) || null;
    if (Object.keys(update).length === 0) throw new HttpError(400, 'Nothing to update.');

    const svc = createSupabaseServiceClient();
    const { error } = await svc.from('offers').update(update).eq('id', params.id).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}

/** DELETE /api/offers/:id — remove an offer (campaigns keep their snapshot text). */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const userId = await requireUserId();
    const svc = createSupabaseServiceClient();
    const { error } = await svc.from('offers').delete().eq('id', params.id).eq('user_id', userId);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
