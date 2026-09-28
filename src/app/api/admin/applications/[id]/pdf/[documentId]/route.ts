import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { prisma } from '@/lib/db';
import { getStorage } from '@/lib/storage';

export async function GET(_request: Request, { params }: { params: { id: string; documentId: string } }) {
  try { await requireRole(['ADMIN', 'SUPER_ADMIN']); const document = await prisma.generatedDocument.findFirst({ where: { id: params.documentId, applicationId: params.id } }); if (!document) return NextResponse.json({ error: 'Not found' }, { status: 404 }); return new NextResponse(await getStorage().get(document.storageKey) as any, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${document.fileName}"` } }); } catch { return NextResponse.json({ error: 'Unauthorized' }, { status: 401 }); }
}