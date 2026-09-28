/**
 * Email delivery abstraction (verification + password reset architecture).
 *
 * A real SMTP/transactional provider can be plugged in later; until then the
 * transport logs link payloads in development so the flows are fully
 * exercised without sending real mail. Templates are isolated here so no
 * caller ever hand-assembles URLs.
 */
import { appConfig } from '@/lib/config';

export interface VerificationMail {
  to: string;
  firstName: string;
  verifyUrl: string;
}

export interface PasswordResetMail {
  to: string;
  firstName: string;
  resetUrl: string;
}

export async function sendVerificationEmail(mail: VerificationMail): Promise<void> {
  // Development transport: log only. Swap for SMTP/API transport in production.
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.info(`[email] verification -> ${mail.to}: ${mail.verifyUrl}`);
  }
}

export async function sendPasswordResetEmail(mail: PasswordResetMail): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.info(`[email] password reset -> ${mail.to}: ${mail.resetUrl}`);
  }
}

export function buildVerifyUrl(token: string): string {
  return `${appConfig.appUrl}/verify-email?token=${encodeURIComponent(token)}`;
}

export function buildResetUrl(token: string): string {
  return `${appConfig.appUrl}/reset-password?token=${encodeURIComponent(token)}`;
}
