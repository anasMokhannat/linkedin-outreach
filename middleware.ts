import { NextResponse, type NextRequest } from 'next/server';

/**
 * Route guard based on the session cookie (presence check only — full HMAC
 * verification happens server-side in the (app) layout / route handlers via
 * getAccountId). Identity is the connected LinkedIn account; there is no
 * separate user auth.
 */
const SESSION_COOKIE = 'fl_session';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = !!request.cookies.get(SESSION_COOKIE)?.value;

  const isProtected = ['/dashboard', '/leads', '/settings'].some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  if (isProtected && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/';
    return NextResponse.redirect(url);
  }

  // Already connected → skip the connect landing.
  if (pathname === '/' && hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
