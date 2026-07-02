import { NextResponse, type NextRequest } from 'next/server';

/**
 * Lightweight route guard: presence check on the app-user session cookie only.
 * Full HMAC verification + the connect-vs-dashboard decision happen server-side
 * (root page + (app) layout). Identity is the app user (email/password); the
 * LinkedIn connection is a separate concern handled after login.
 */
const USER_COOKIE = 'fl_user';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = !!request.cookies.get(USER_COOKIE)?.value;

  const isProtected = ['/dashboard', '/leads', '/campaigns', '/inbox', '/settings', '/connect'].some(
    (p) => pathname === p || pathname.startsWith(p + '/')
  );

  if (isProtected && !hasSession) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api).*)'],
};
