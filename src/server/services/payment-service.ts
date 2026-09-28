import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/db';
import { getLatestPriceCalculation } from './pricing-service';
import { isProxySigned } from './proxy-service';
import { appConfig } from '@/lib/config';

export async function createPaymentAttempt(applicationId: string, userId: string) {
  const application = await prisma.application.findFirst({ where: { id: applicationId, userId }, include: { documents: { where: { status: { not: 'REPLACED' } } } } });
  if (!application) throw new Error('APPLICATION_NOT_FOUND');
  if (application.documents.some((d) => d.status !== 'PROCESSED')) throw new Error('DOCUMENTS_INCOMPLETE');
  if (!(await isProxySigned(applicationId))) throw new Error('PROXY_SIGNATURE_REQUIRED');
  const price = await getLatestPriceCalculation(applicationId);
  if (!price) throw new Error('PRICE_NOT_CALCULATED');
  const reference = `GF-${randomUUID()}`;
  const attempt = await prisma.paymentAttempt.create({ data: { applicationId, provider: appConfig.payment.provider, reference, amount: price.total, currency: price.currency, status: appConfig.payment.ozowApiKey ? 'PENDING' : 'CONFIGURATION_REQUIRED' } });
  if (!appConfig.payment.ozowApiKey) return { attempt, checkoutUrl: null, configured: false };
  const response = await fetch(`${appConfig.payment.ozowApiUrl}/transactions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${appConfig.payment.ozowApiKey}` }, body: JSON.stringify({ merchantId: appConfig.payment.ozowMerchantId, reference, amount: Number(price.total), currency: price.currency, returnUrl: `${appConfig.appUrl}/dashboard/${applicationId}/payment?status=complete`, cancelUrl: `${appConfig.appUrl}/dashboard/${applicationId}/payment?status=cancelled`, callbackUrl: `${appConfig.appUrl}/api/payments/ozow/webhook` }) });
  if (!response.ok) throw new Error('OZOW_CHECKOUT_FAILED');
  const payload = await response.json() as { resource?: { data?: { link?: string } } };
  const checkoutUrl = payload.resource?.data?.link ?? null;
  await prisma.paymentAttempt.update({ where: { id: attempt.id }, data: { checkoutUrl } });
  return { attempt, checkoutUrl, configured: true };
}
