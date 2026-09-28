import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { appConfig } from '@/lib/config';
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

/** requireAuth: throws 401 if not logged in. */
export async function requireAuth(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) throw new HttpError(401, 'Authentication required');
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

