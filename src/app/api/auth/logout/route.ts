import { NextResponse } from 'next/server';
import { clearSession, getSessionUser } from '@/lib/auth/session';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';

export async function POST() {
  const session = await getSessionUser();
  if (session) {
    await audit.log({
      action: AUDIT_ACTIONS.AUTH_LOGOUT,
      entity: 'User',
      entityId: session.sub,
      actorId: session.sub,
      actorRole: session.role,
    });
  }

  const res = NextResponse.json({ ok: true });
  return await clearSession(res);
}
