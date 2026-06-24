import { NextResponse } from 'next/server';
import { HttpError } from './auth';

/** Uniform JSON error responses; maps HttpError to its status. */
export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  // NOTE: never include cookie/secret material in error bodies.
  return NextResponse.json({ error: message }, { status: 500 });
}

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}
