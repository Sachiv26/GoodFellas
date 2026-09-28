import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { appConfig } from '@/lib/config';
import { prisma } from '@/lib/db';
import {
  createSessionToken,
  verifySessionToken,
  SESSION_COOKIE_ATTRIBUTES,
  type SessionPayload,
} from './jwt';
import type { UserRole } from '@prisma/client';
import { sessionCookieMaxAge } from './ttl';

/** Create a session and set the httpOnly cookie on the response. */
export async function establishSession(
  response: NextResponse,
  payload: SessionPayload
): Promise<NextResponse> {
  const token = await createSessionToken(payload, appConfig.jwtSecret, appConfig.jwtExpiresIn);
  response.cookies.set(appConfig.sessionCookieName, token, {
    ...SESSION_COOKIE_ATTRIBUTES,
    // Derived from JWT_EXPIRES_IN so the cookie never outlives (or under-lives)
    // the token it carries.
    maxAge: sessionCookieMaxAge(appConfig.jwtExpiresIn),
  });
  return response;
}

export async function clearSession(response: NextResponse): Promise<NextResponse> {
  response.cookies.set(appConfig.sessionCookieName, '', {
    ...SESSION_COOKIE_ATTRIBUTES,
    maxAge: 0,
  });
  return response;
}

/** Read and verify the session from cookies. Returns null if unauthenticated. */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(appConfig.sessionCookieName)?.value;
  if (!token) return null;
  return verifySessionToken(token, appConfig.jwtSecret);
}


export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * requireAuth: throws 401 if not logged in.
 *
 * The JWT is only proof that the token was signed by us and has not expired; it
 * is NOT proof the account still exists. A cookie issued before a database
 * reseed, a restore, or a user deletion keeps verifying successfully while its
 * `sub` no longer resolves, and any route that then writes `userId: session.sub`
 * fails with a raw Prisma P2003 foreign-key error surfaced to the user as an
 * opaque 500. Re-checking the user here turns that into an honest 401 and, more
 * importantly, prevents the write from being attempted at all.
 */
export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new HttpError(401, 'Authentication required');
  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, isActive: true },
  });
  if (!user) {
    // The account behind this cookie no longer exists. Sign the user out so the
    // browser stops replaying a cookie that can never become valid again.
    throw new HttpError(401, 'Your session is no longer valid. Please sign in again.');
  }
  if (!user.isActive) {
    throw new HttpError(403, 'This account has been deactivated.');
  }
  return session;
}

/** requireRole: throws 401/403 based on auth state. */
export async function requireRole(roles: UserRole[]): Promise<SessionPayload> {
  const session = await requireAuth();
  if (!roles.includes(session.role)) {
    throw new HttpError(403, 'Insufficient permissions');
  }
  return session;
}

/**
 * Server-Component-safe authentication.
 *
 * `requireAuth` throws an `HttpError`, which is correct inside a route handler
 * (the handler catches it and returns a JSON status) but wrong inside a Server
 * Component: nothing catches it there, so an invalid or stale session rendered
 * Next.js's "Unhandled Runtime Error" overlay instead of sending the visitor to
 * the sign-in page. These helpers redirect instead of throwing, so a stale
 * cookie always lands on `/login` and can be replaced by signing in again.
 */
export async function requirePageAuth(nextPath?: string): Promise<SessionPayload> {
  const session = await getSession();
  if (session) {
    const user = await prisma.user.findUnique({
      where: { id: session.sub },
      select: { id: true, isActive: true },
    });
    if (user && user.isActive) return session;
  }
  redirectToLogin(nextPath);
}

export async function requirePageRole(
  roles: UserRole[],
  nextPath?: string
): Promise<SessionPayload> {
  const session = await requirePageAuth(nextPath);
  if (!roles.includes(session.role)) redirect('/dashboard');
  return session;
}

/**
 * Send an unauthenticated visitor to the sign-in page, preserving where they
 * were headed so login can return them there.
 */
function redirectToLogin(nextPath?: string): never {
  const target = new URL('/login', process.env.APP_URL ?? 'http://localhost:3000');
  if (nextPath) target.searchParams.set('next', nextPath);
  redirect(target.pathname + target.search);
}

export function isAdmin(session: SessionPayload | null): boolean {
  return session?.role === 'ADMIN' || session?.role === 'SUPER_ADMIN';
}

/** Alias used by route handlers: the verified session payload, or null. */
export async function getSessionUser(): Promise<SessionPayload | null> {
  return getSession();
}

/** Best-effort client IP for audit records (never trusted for authorization). */
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return request.headers.get('x-real-ip');
}

