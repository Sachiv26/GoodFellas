import { SignJWT, jwtVerify } from 'jose';
import type { UserRole } from '@prisma/client';

const JWT_ISSUER = 'goodfellas';
const JWT_AUDIENCE = 'goodfellas-app';

export interface SessionPayload {
  sub: string; // user id
  role: UserRole;
  email: string;
}

function getSecret(secret: string): Uint8Array {
  if (!secret || secret.length < 16) {
    throw new Error('JWT secret is missing or too short');
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(
  payload: SessionPayload,
  secret: string,
  expiresIn: string | number = '7d'
): Promise<string> {
  return new SignJWT({ role: payload.role, email: payload.email })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(getSecret(secret));
}

export async function verifySessionToken(
  token: string,
  secret: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(secret), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (!payload.sub || typeof payload.role !== 'string' || typeof payload.email !== 'string') {
      return null;
    }
    return {
      sub: payload.sub,
      role: payload.role as UserRole,
      email: payload.email,
    };
  } catch {
    // invalid, expired, or malformed token
    return null;
  }
}

export const SESSION_COOKIE_ATTRIBUTES = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};
