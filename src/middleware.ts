import { NextResponse, type NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

/**
 * Edge route protection. This is a convenience gate only — every API route
 * and server action independently verifies the session server-side
 * (`requireAuth` / `requireRole`). Never rely on this middleware alone for
 * authorization of data access.
 */

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? 'goodfellas_session';
const JWT_SECRET = process.env.JWT_SECRET ?? '';

async function readSession(req: NextRequest): Promise<{ role: string } | null> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token || !JWT_SECRET || JWT_SECRET.length < 16) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(JWT_SECRET), {
      issuer: 'goodfellas',
      audience: 'goodfellas-app',
    });
    if (!payload.sub || typeof payload.role !== 'string') return null;
    return { role: payload.role };
  } catch {
    return null;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.url ? new URL(req.url) : { pathname: req.nextUrl.pathname };
  const session = await readSession(req);
  const loginUrl = new URL('/login', req.nextUrl);
  loginUrl.searchParams.set('next', pathname);

  if (pathname.startsWith('/admin')) {
    if (!session) return NextResponse.redirect(loginUrl);
    if (session.role !== 'ADMIN' && session.role !== 'SUPER_ADMIN') {
      return NextResponse.redirect(new URL('/dashboard', req.nextUrl));
    }
    return NextResponse.next();
  }

  if (pathname.startsWith('/dashboard')) {
    if (!session) return NextResponse.redirect(loginUrl);
    return NextResponse.next();
  }

  // NOTE: auth pages are intentionally NOT redirected here.
  //
  // `readSession` below verifies the JWT signature only — it cannot see the
  // database, so a cookie whose user no longer exists still looks "signed in".
  // If this middleware bounced such a cookie away from /login, the login page
  // would send it back here, the Server Component would reject it again, and the
  // browser would loop until it gave up with ERR_TOO_MANY_REDIRECTS. The login
  // page itself checks the account against the database and only redirects when
  // the session is genuinely valid, so the stale cookie renders the form and
  // signing in replaces it.
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/login', '/register'],
};
