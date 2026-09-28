import { NextResponse } from 'next/server';
import { createApplicationSchema } from '@/lib/validation';
import { createApplication } from '@/server/services/application-service';
import { requireAuth, HttpError } from '@/lib/auth/session';
import { apiError } from '@/lib/api/errors';
import { audit, AUDIT_ACTIONS } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const session = await requireAuth();
    const parsed = createApplicationSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return apiError('VALIDATION_ERROR', 'Please check the application details.', 400);
    const application = await createApplication(session.sub, parsed.data);
    await audit.log({ action: AUDIT_ACTIONS.APPLICATION_CREATED, entity: 'Application', entityId: application.id, actorId: session.sub, actorRole: session.role, metaData: { productSlug: parsed.data.productSlug } });
    return NextResponse.json({ application }, { status: 201 });
  } catch (error) {
    // Log the real cause before masking it, otherwise every failure looks identical.
    console.error('[api] application create failed:', error);
    if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') return apiError('NOT_FOUND', 'Product not found', 404);
    // Surface the real auth failure (stale session, deactivated account) instead
    // of masking it as a 500. HttpError carries the intended status.
    if (error instanceof HttpError) return apiError(error);
    return apiError('INTERNAL_ERROR', 'Could not create the application.', 500);
  }
}
