import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { appConfig } from '@/lib/config';

export async function POST(request: Request) {
  const raw = await request.text();
  if (!appConfig.payment.ozowApiKey) return NextResponse.json({ error: 'Payment gateway is not configured.' }, { status: 503 });
  const body = raw ? JSON.parse(raw) as { event?: string; data?: { reference?: string } } : {};
  const reference = body.data?.reference ?? body.event;
  if (reference) await prisma.paymentAttempt.updateMany({ where: { reference }, data: { status: 'PAID' } });
  return NextResponse.json({ received: true });
}
