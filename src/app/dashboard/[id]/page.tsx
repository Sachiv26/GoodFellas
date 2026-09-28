import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireAuth } from '@/lib/auth/session';
import { getApplicationDetailForUser } from '@/server/services/application-service';
import UploadDocuments from './UploadDocuments';
import ProxyButton from './ProxyButton';
import { prisma } from '@/lib/db';
import { getLatestPriceCalculation } from '@/server/services/pricing-service';
import AppMenu from '@/components/AppMenu';

export const dynamic = 'force-dynamic';

export default async function ApplicationPage({ params }: { params: { id: string } }) {
  const session = await requireAuth();
  const application = await getApplicationDetailForUser(params.id, session.sub);
  if (!application) notFound();
  const price = await getLatestPriceCalculation(application.id);
  const signedProxy = await prisma.generatedDocument.findFirst({ where: { applicationId: application.id, createdBy: session.sub, fileName: { endsWith: '-proxy-authorisation.pdf' } }, orderBy: { createdAt: 'desc' }, select: { id: true, extractionSnapshot: true } });
  const signed = Boolean(signedProxy && (signedProxy.extractionSnapshot as any)?.signatureProvided === true);
  const paymentReady = Boolean(price && signed && application.documents.every((d) => d.status === 'PROCESSED'));
  return <main className="mx-auto max-w-4xl px-4 py-10"><AppMenu /><Link href="/dashboard" className="text-sm font-medium text-slate-700 hover:underline">← Back to applications</Link><header className="mt-4 border-b border-slate-200 pb-6"><p className="text-sm text-slate-700">{application.applicationNumber}</p><h1 className="mt-1 text-3xl font-bold text-slate-900">{application.productName}</h1><p className="mt-2 text-slate-600">Status: {application.status.replaceAll('_', ' ')}</p></header><UploadDocuments application={application} /><ProxyButton applicationId={application.id} initialDocumentId={signedProxy?.id ?? null} />{paymentReady ? <div className="mt-6 text-right"><a className="btn-primary" href={`/dashboard/${application.id}/payment`}>Continue to payment</a></div> : null}</main>;
}
