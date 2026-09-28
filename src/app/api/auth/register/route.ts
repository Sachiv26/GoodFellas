import { NextResponse } from 'next/server';
import { registerCustomer } from '@/server/services/auth-service';
import { registerSchema } from '@/lib/validation';
import { apiError } from '@/lib/api/errors';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';
import { clientIp, establishSession } from '@/lib/auth/session';

export async function POST(request: Request) {
  const parsed = registerSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Please check the highlighted fields.', 400);
  }

  try {
    const { user, payload } = await registerCustomer(parsed.data);

    await audit.log({
      action: AUDIT_ACTIONS.AUTH_REGISTER,
      entity: 'User',
      entityId: user.id,
      actorId: user.id,
      actorRole: user.role,
      ipAddress: clientIp(request),
      metaData: { email: user.email },
    });

    const res = NextResponse.json({ user }, { status: 201 });
    return await establishSession(res, payload);
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_TAKEN') {
      return apiError('EMAIL_TAKEN', 'An account with this email already exists.', 409);
    }
    return apiError('INTERNAL_ERROR', 'Registration failed. Please try again.', 500);
  }
}
