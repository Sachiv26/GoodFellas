import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { signProxyPdf } from '@/server/services/proxy-service';

export async function POST(request: Request, { params }: { params: { id: string; documentId: string } }) {
  try { const session = await requireAuth(); const body = await request.json().catch(() => ({})); const document = await signProxyPdf(params.id, session.sub, params.documentId, typeof body.signature === 'string' ? body.signature : ''); return NextResponse.json({ document: { id: document.id, fileName: document.fileName } }); } catch (error) { const message = error instanceof Error ? error.message : 'Could not sign proxy PDF.'; return NextResponse.json({ error: message }, { status: message === 'SIGNATURE_REQUIRED' ? 400 : message === 'PROXY_NOT_FOUND' ? 404 : 500 }); }
}
