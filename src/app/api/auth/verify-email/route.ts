import { NextResponse } from 'next/server';
import { verifyEmailToken } from '@/server/services/auth-service';
import { verifyEmailSchema } from '@/lib/validation';
import { apiError } from '@/lib/api/errors';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';

export async function POST(request: Request) {
  const parsed = verifyEmailSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'The verification link is invalid.', 400);
  }

  try {
    const userId = await verifyEmailToken(parsed.data.token);

    await audit.log({
      action: AUDIT_ACTIONS.AUTH_EMAIL_VERIFIED,
      entity: 'User',
      entityId: userId,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_TOKEN') {
      return apiError('INVALID_TOKEN', 'The verification link is invalid or expired.', 400);
    }
    return apiError('INTERNAL_ERROR', 'Verification failed.', 500);
  }
}
