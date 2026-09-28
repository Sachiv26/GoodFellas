import { requireAuth } from '@/lib/auth/session';
import { getApplicationDetailForUser } from '@/server/services/application-service';
import { getLatestPriceCalculation } from '@/server/services/pricing-service';
import { isProxySigned } from '@/server/services/proxy-service';
import { formatAmount } from '@/lib/pricing/breakdown';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import PaymentClient from './PaymentClient';
import PriceBreakdown from './PriceBreakdown';

export const dynamic = 'force-dynamic';

export default async function PaymentPage({ params, searchParams }: { params: { id: string }; searchParams: { status?: string } }) {
  const session = await requireAuth();
  const application = await getApplicationDetailForUser(params.id, session.sub);
  if (!application) notFound();
  const price = await getLatestPriceCalculation(params.id);
  const signed = await isProxySigned(params.id);
  return <main className="mx-auto max-w-3xl px-4 py-10"><Link href={`/dashboard/${params.id}`} className="text-sm font-medium text-slate-700 hover:underline">← Back to application</Link><header className="mt-4"><p className="text-sm text-slate-700">{application.applicationNumber}</p><h1 className="mt-1 text-3xl font-bold text-slate-900">Payment</h1><p className="mt-2 text-slate-600">Secure payment gateway framework</p></header><div className="card mt-6"><p className="text-sm text-slate-600">Amount due</p><p className="mt-1 text-3xl font-bold text-slate-900">{price ? formatAmount(Number(price.total), price.currency) : 'Price not calculated'}</p><p className="mt-2 text-sm text-slate-600">Ozow checkout will open after server-side eligibility checks.</p></div>{price ? <PriceBreakdown breakdown={price.breakdown} total={price.total} currency={price.currency} /> : null}<PaymentClient applicationId={params.id} signed={signed} documentsComplete={application.documents.every((d) => d.status === 'PROCESSED')} hasPrice={Boolean(price)} status={searchParams.status} /></main>;
}
