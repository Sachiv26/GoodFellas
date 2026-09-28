import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { getStorage } from '@/lib/storage';

export async function GET(_request: Request, { params }: { params: { id: string; documentId: string } }) {
  try {
    const session = await requireAuth();
    const document = await prisma.generatedDocument.findFirst({ where: { id: params.documentId, applicationId: params.id, createdBy: session.sub, fileName: { endsWith: '-proxy-authorisation.pdf' } } });
    if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(await getStorage().get(document.storageKey) as any, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${document.fileName}"`, 'Cache-Control': 'private, no-store' } });
  } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
}
