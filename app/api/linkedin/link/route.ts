import { requireUserId } from '@/lib/auth';
import { errorResponse, json } from '@/lib/http';
import { unipileFindLatestLinkedInAccount } from '@/lib/unipile';
import { finalizeConnection } from '@/lib/connect';

export const runtime = 'nodejs';

/**
 * POST /api/linkedin/link
 *
 * Links an already-connected Unipile account (e.g. connected via the Unipile
 * dashboard) to the signed-in user — picks the newest OK LinkedIn account on
 * the workspace. Single-user-workspace friendly.
 */
export async function POST() {
  try {
    const userId = await requireUserId();
    const found = await unipileFindLatestLinkedInAccount();
    if (!found) return json({ error: 'No connected LinkedIn account found on Unipile.' }, 404);
    return await finalizeConnection(found.accountId, null, userId);
  } catch (err) {
    return errorResponse(err);
  }
}
