import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/session';
import { createPaymentAttempt } from '@/server/services/payment-service';

export async function POST(_request: Request, { params }: { params: { id: string } }) {
  try { const session = await requireAuth(); const result = await createPaymentAttempt(params.id, session.sub); return NextResponse.json({ attempt: { id: result.attempt.id, status: result.attempt.status, amount: Number(result.attempt.amount), currency: result.attempt.currency }, checkoutUrl: result.checkoutUrl, configured: result.configured }); } catch (error) { const message = error instanceof Error ? error.message : 'Could not start payment.'; const status = ['APPLICATION_NOT_FOUND'].includes(message) ? 404 : ['DOCUMENTS_INCOMPLETE', 'PROXY_SIGNATURE_REQUIRED', 'PRICE_NOT_CALCULATED'].includes(message) ? 409 : 500; return NextResponse.json({ error: message }, { status }); }
}
