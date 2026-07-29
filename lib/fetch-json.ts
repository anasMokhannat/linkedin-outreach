/**
 * Client-side fetch that parses JSON and throws on a non-OK response, surfacing
 * the API's `error` message. Handlers wrap this in try/catch and reset their
 * loading/busy flag in a `finally`, so a failed request never leaves a spinner
 * or a disabled button stuck.
 */
export async function fetchJson<T = unknown>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const res = await fetch(input, init);
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Empty or non-JSON body — leave data as null.
  }
  if (!res.ok) {
    const msg = (data as { error?: string } | null)?.error;
    throw new Error(msg || `Request failed (${res.status})`);
  }
  return data as T;
}
