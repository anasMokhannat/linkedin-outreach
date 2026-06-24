import 'server-only';
import { createSupabaseServerClient } from './supabase-server';

/**
 * Resolve the authenticated user in a route handler / server component.
 * Returns null when there is no valid session.
 */
export async function getSessionUser() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Throw a 401 if there is no session; otherwise return the user id. */
export async function requireUserId(): Promise<string> {
  const user = await getSessionUser();
  if (!user) throw new HttpError(401, 'Not authenticated');
  return user.id;
}
