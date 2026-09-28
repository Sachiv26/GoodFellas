import { NextResponse } from 'next/server';
import { resetPassword } from '@/server/services/auth-service';
import { resetPasswordSchema } from '@/lib/validation';
import { apiError } from '@/lib/api/errors';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';
import { clientIp } from '@/lib/auth/session';

export async function POST(request: Request) {
  const parsed = resetPasswordSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'The reset link is invalid or expired.', 400);
  }

  try {
    const userId = await resetPassword(parsed.data.token, parsed.data.password);

    await audit.log({
      action: AUDIT_ACTIONS.AUTH_PASSWORD_RESET_COMPLETED,
      entity: 'User',
      entityId: userId,
      ipAddress: clientIp(request),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_TOKEN') {
      return apiError('INVALID_TOKEN', 'The reset link is invalid or expired.', 400);
    }
    return apiError('INTERNAL_ERROR', 'Password reset failed.', 500);
  }
}
