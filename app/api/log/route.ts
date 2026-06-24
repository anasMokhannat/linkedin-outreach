import { requireUserId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { createSupabaseServerClient } from '@/lib/supabase-server';

export const runtime = 'nodejs';

/** GET /api/log — recent audit events for the current user (dashboard view). */
export async function GET() {
  try {
    await requireUserId();
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('send_log')
      .select('id, event, detail, created_at, message_id')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return json({ events: data ?? [] });
  } catch (err) {
    return errorResponse(err);
  }
}
