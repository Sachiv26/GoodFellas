import { NextResponse } from 'next/server';
import { requestPasswordReset } from '@/server/services/auth-service';
import { forgotPasswordSchema } from '@/lib/validation';
import { apiError } from '@/lib/api/errors';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';
import { clientIp } from '@/lib/auth/session';

export async function POST(request: Request) {
  const parsed = forgotPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Enter a valid email address.', 400);
  }

  try {
    const created = await requestPasswordReset(parsed.data.email);

    // Do not reveal whether the account exists.
    if (created) {
      await audit.log({
        action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_REQUESTED,
        entity: 'User',
        entityId: created,
        ipAddress: clientIp(request),
      });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return apiError('INTERNAL_ERROR', 'Request failed. Please try again.', 500);
  }
}
