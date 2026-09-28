import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { generateApplicationPdf } from '@/server/services/pdf-service';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try { const session = await requireRole(['ADMIN', 'SUPER_ADMIN']); const document = await generateApplicationPdf(params.id, session.sub); return NextResponse.json({ document: { id: document.id, fileName: document.fileName } }, { status: 201 }); } catch { return NextResponse.json({ error: 'Could not generate PDF.' }, { status: 500 }); }
}