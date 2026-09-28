/**
 * Authentication service: registration, login, password reset, email
 * verification. bcryptjs hashing + AuthToken (hashed one-time tokens) +
 * jose session payloads; the httpOnly cookie is set by the route via
 * `establishSession`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import type { SessionPayload } from '@/lib/auth/jwt';
import type { AuthTokenKind, User } from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { RegistrationInput, LoginInput } from '@/lib/validation';
import {
  buildResetUrl,
  buildVerifyUrl,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from './email-service';

export interface AuthenticatedUserDto {
  id: string;
  firstName: string;
  surname: string;
  email: string;
  mobileNumber: string;
  role: User['role'];
  emailVerified: boolean;
}

export interface AuthResult {
  user: AuthenticatedUserDto;
  payload: SessionPayload;
}

const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function toAuthUserDto(user: User): AuthenticatedUserDto {
  return {
    id: user.id,
    firstName: user.firstName,
    surname: user.surname,
    email: user.email,
    mobileNumber: user.mobileNumber,
    role: user.role,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

function toSessionPayload(user: User): SessionPayload {
  return { sub: user.id, role: user.role, email: user.email };
}

async function issueToken(userId: string, kind: AuthTokenKind, ttlMs: number): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await prisma.authToken.create({
    data: {
      userId,
      kind,
      tokenHash: sha256(raw),
      expiresAt: new Date(Date.now() + ttlMs),
    },
  });
  return raw;
}

async function consumeToken(raw: string, kind: AuthTokenKind): Promise<User> {
  const token = await prisma.authToken.findUnique({
    where: { tokenHash: sha256(raw) },
    include: { user: true },
  });
  if (
    !token ||
    token.kind !== kind ||
    token.consumedAt !== null ||
    token.expiresAt.getTime() < Date.now()
  ) {
    throw new Error('INVALID_TOKEN');
  }
  await prisma.authToken.update({ where: { id: token.id }, data: { consumedAt: new Date() } });
  return token.user;
}

export async function registerCustomer(input: RegistrationInput): Promise<AuthResult> {
  const email = input.email.toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error('EMAIL_TAKEN');

  let user: User;
  try {
    user = await prisma.user.create({
      data: {
        email,
        firstName: input.firstName,
        surname: input.surname,
        mobileNumber: input.mobileNumber,
        passwordHash: await hashPassword(input.password),
        role: 'CUSTOMER',
      },
    });
  } catch (error) {
    // Two simultaneous registrations for the same address both pass the
    // read-then-write check above; the unique index is the real guard, so the
    // P2002 it raises must surface as EMAIL_TAKEN (409) and not a 500.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new Error('EMAIL_TAKEN');
    }
    throw error;
  }

  const verifyToken = await issueToken(user.id, 'EMAIL_VERIFICATION', VERIFY_TOKEN_TTL_MS);
  await sendVerificationEmail({
    to: user.email,
    firstName: user.firstName,
    verifyUrl: buildVerifyUrl(verifyToken),
  });

  return { user: toAuthUserDto(user), payload: toSessionPayload(user) };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email.toLowerCase() } });
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    throw new Error('INVALID_CREDENTIALS');
  }
  if (!user.isActive) throw new Error('INACTIVE_ACCOUNT');
  return { user: toAuthUserDto(user), payload: toSessionPayload(user) };
}

/** Returns the user id when a reset was created; null when unknown email. */
export async function requestPasswordReset(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !user.isActive) return null;

  const token = await issueToken(user.id, 'PASSWORD_RESET', RESET_TOKEN_TTL_MS);
  await sendPasswordResetEmail({
    to: user.email,
    firstName: user.firstName,
    resetUrl: buildResetUrl(token),
  });
  return user.id;
}

export async function resetPassword(rawToken: string, password: string): Promise<string> {
  const user = await consumeToken(rawToken, 'PASSWORD_RESET');
  const passwordHash = await hashPassword(password);
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    // Any other outstanding reset tokens are now stale.
    prisma.authToken.updateMany({
      where: { userId: user.id, kind: 'PASSWORD_RESET', consumedAt: null },
      data: { consumedAt: new Date() },
    }),
  ]);
  return user.id;
}

export async function verifyEmailToken(rawToken: string): Promise<string> {
  const user = await consumeToken(rawToken, 'EMAIL_VERIFICATION');
  if (!user.emailVerifiedAt) {
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerifiedAt: new Date() },
    });
  }
  return user.id;
}
