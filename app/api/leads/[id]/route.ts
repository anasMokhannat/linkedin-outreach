import { requireUserId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/**
 * DELETE /api/leads/:id — remove a lead and (via FK cascade) its enrichment and
 * messages. RLS-scoped, so a user can only delete their own lead.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireUserId();
    const supabase = createSupabaseServerClient();
    const { error } = await supabase.from('leads').delete().eq('id', params.id);
    if (error) throw new Error(error.message);
    return json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
