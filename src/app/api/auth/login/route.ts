import { NextResponse } from 'next/server';
import { login } from '@/server/services/auth-service';
import { loginSchema } from '@/lib/validation';
import { apiError } from '@/lib/api/errors';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';
import { clientIp, establishSession } from '@/lib/auth/session';

export async function POST(request: Request) {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError('VALIDATION_ERROR', 'Invalid email or password.', 400);
  }

  try {
    const { user, payload } = await login(parsed.data);

    await audit.log({
      action: AUDIT_ACTIONS.AUTH_LOGIN,
      entity: 'User',
      entityId: user.id,
      actorId: user.id,
      actorRole: user.role,
      ipAddress: clientIp(request),
    });

    const res = NextResponse.json({ user });
    return await establishSession(res, payload);
  } catch (error) {
    if (error instanceof Error && error.message === 'INVALID_CREDENTIALS') {
      return apiError('INVALID_CREDENTIALS', 'Invalid email or password.', 401);
    }
    if (error instanceof Error && error.message === 'INACTIVE_ACCOUNT') {
      return apiError('INACTIVE_ACCOUNT', 'This account has been deactivated.', 403);
    }
    return apiError('INTERNAL_ERROR', 'Sign-in failed. Please try again.', 500);
  }
}
