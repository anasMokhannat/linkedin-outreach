import { NextResponse } from 'next/server';
import { HttpError } from './auth';
import { UnipileError } from './unipile';
import { log } from './log';

/** Friendly messages for known Unipile error types. */
function unipileMessage(type: string, fallback: string): string {
  switch (type) {
    case 'errors/invalid_credentials':
      return 'LinkedIn rejected those credentials. Check the email/password — note that accounts with 2FA often can’t use password login; try the cookie method instead.';
    case 'errors/invalid_checkpoint_solution':
      return 'That verification code was not accepted — please try again.';
    case 'errors/disconnected_account':
      return 'This LinkedIn session is disconnected — reconnect your account.';
    default:
      return fallback;
  }
}

/** Uniform JSON error responses; maps HttpError + UnipileError to clean statuses. */
export function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  if (err instanceof UnipileError) {
    // Surface a 4xx for client-fixable problems; 502 for upstream failures.
    const status = err.status >= 400 && err.status < 500 ? err.status : 502;
    log.warn('api', 'unipile error', { status: err.status, type: err.type, message: err.message });
    return NextResponse.json({ error: unipileMessage(err.type, err.message) }, { status });
  }
  const message = err instanceof Error ? err.message : 'Internal error';
  // Log the full error server-side (stack included); never put secrets in the body.
  log.error('api', 'unhandled error', {
    message,
    stack: err instanceof Error ? err.stack : undefined,
  });
  return NextResponse.json({ error: message }, { status: 500 });
}

export function json<T>(data: T, status = 200) {
  return NextResponse.json(data, { status });
}
