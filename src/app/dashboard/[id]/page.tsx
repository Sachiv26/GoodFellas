import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requirePageAuth } from '@/lib/auth/session';
import { getApplicationDetailForUser } from '@/server/services/application-service';
import UploadDocuments from './UploadDocuments';
import ProxyButton from './ProxyButton';
import { prisma } from '@/lib/db';
import { getLatestPriceCalculation } from '@/server/services/pricing-service';
import AppMenu from '@/components/AppMenu';

export const dynamic = 'force-dynamic';

export default async function ApplicationPage({ params }: { params: { id: string } }) {
  const session = await requirePageAuth(`/dashboard/${params.id}`);
  const application = await getApplicationDetailForUser(params.id, session.sub);
  if (!application) notFound();
  const price = await getLatestPriceCalculation(application.id);
  const signedProxy = await prisma.generatedDocument.findFirst({
    where: {
      applicationId: application.id,
      createdBy: session.sub,
      fileName: { endsWith: '-proxy-authorisation.pdf' },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, extractionSnapshot: true },
  });
  const signed = Boolean(signedProxy && (signedProxy.extractionSnapshot as { signatureProvided?: unknown } | null)?.signatureProvided === true);
  const documentsComplete = application.documents.every((d) => d.status === 'PROCESSED');

  // The payment button is ALWAYS rendered. It used to be hidden until every
  // document was processed, the proxy was signed and a price existed, which made
  // the control appear to be missing rather than not-yet-eligible. The server
  // still enforces those rules in `createPaymentAttempt`; the button simply
  // explains the current state instead of disappearing.
  const blockers: string[] = [];
  if (!documentsComplete) blockers.push('all documents must be processed');
  if (!signed) blockers.push('the proxy must be signed');
  if (!price) blockers.push('a price must be calculated');

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <AppMenu />
      <Link href="/dashboard" className="text-sm font-medium text-slate-700 hover:underline">â† Back to applications</Link>

      <header className="mt-4 border-b border-slate-200 pb-6">
        <p className="text-sm text-slate-700">{application.applicationNumber}</p>
        <h1 className="mt-1 text-3xl font-bold text-slate-900">{application.productName}</h1>
        <p className="mt-2 text-slate-600">Status: {application.status.replaceAll('_', ' ')}</p>
      </header>

      <UploadDocuments application={application} />
      <ProxyButton applicationId={application.id} initialDocumentId={signedProxy?.id ?? null} />

      <section className="card mt-8">
        <h2 className="text-lg font-semibold text-slate-900">Payment</h2>
        {blockers.length ? (
          <p className="mt-2 text-sm text-slate-600">
            You will be able to pay once {blockers.join(', ')}.
          </p>
        ) : (
          <p className="mt-2 text-sm text-slate-600">Everything is ready. You can continue to payment.</p>
        )}
        <div className="mt-4">
          <a className="btn-primary inline-flex" href={`/dashboard/${application.id}/payment`}>
            Continue to payment
          </a>
        </div>
      </section>
    </main>
  );
}
