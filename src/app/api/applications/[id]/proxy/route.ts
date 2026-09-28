import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { generateProxyPdf } from '@/server/services/proxy-service';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try { const session = await requireAuth(); const document = await generateProxyPdf(params.id, session.sub); return NextResponse.json({ document: { id: document.id, fileName: document.fileName } }, { status: 201 }); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create proxy PDF.' }, { status: error instanceof Error && error.message === 'APPLICATION_NOT_FOUND' ? 404 : 500 }); }
}
