import { NextResponse } from 'next/server';
import { createApplicationSchema } from '@/lib/validation';
import { createApplication } from '@/server/services/application-service';
import { requireAuth } from '@/lib/auth/session';
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
    if (error instanceof Error && error.message === 'PRODUCT_NOT_FOUND') return apiError('NOT_FOUND', 'Product not found', 404);
    if (error instanceof Error && error.message === 'Authentication required') return apiError('UNAUTHORIZED', error.message, 401);
    return apiError('INTERNAL_ERROR', 'Could not create the application.', 500);
  }
}
