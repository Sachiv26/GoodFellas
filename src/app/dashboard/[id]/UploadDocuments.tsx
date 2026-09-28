'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerApplicationDetailDto } from '@/types/dto';
import BarcodeScanner from './BarcodeScanner';

/**
 * The licence disc is captured with a REALTIME camera barcode scan, not a file
 * upload. The barcode is the only data source in this application (no OCR and
 * no AI), so the decoded value is all the vehicle information the system gets.
 * The ID and proof of residence are still stored for the record, but nothing is
 * read out of them.
 */
const BARCODE_DOCUMENT_CODE = 'VEHICLE_LICENCE_DISC';

/**
 * A file input that is the real tap target, overlaid on the button.
 *
 * A clipped `sr-only` input is unreliable for camera capture: iOS ignores
 * programmatic clicks on a zero-size/clipped file input, so tapping the label
 * can silently do nothing. Overlaying a transparent, full-size input means the
 * user's tap lands on the input itself on every browser, and the label keeps
 * the button's styling.
 */
function FileInput({ accept, onChange, disabled }: { accept: string; onChange: React.ChangeEventHandler<HTMLInputElement>; disabled: boolean }) {
  return <input type="file" accept={accept} disabled={disabled} onChange={onChange} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />;
}

export default function UploadDocuments({ application }: { application: CustomerApplicationDetailDto }) {
  const router = useRouter();
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [scanning, setScanning] = useState(false);
  const [processing, setProcessing] = useState(false);

  // The upload returns as soon as the file is durably stored; decoding and
  // pricing happen in the background. Polling is what makes that visible —
  // without it the spinner would stop with no confirmation anything happened.
  /**
   * Whether any document is still in a transient state. A document that lands in
   * NEEDS_REVIEW is settled, not pending, so polling stops once this is false.
   */
  const anyPending = application.documents.some(
    (doc) => doc.status === 'UPLOADED' || doc.status === 'PROCESSING'
  );

  useEffect(() => {
    if (!processing) return;
    // Stop polling as soon as the server reports a settled state for every
    // document, so the page does not refresh forever on a stuck upload.
    if (!anyPending) {
      setProcessing(false);
      setMessage('Document processed successfully.');
      return;
    }
    const timer = setInterval(() => router.refresh(), 1500);
    return () => clearInterval(timer);
  }, [processing, router, anyPending]);

  async function upload(requirementId: string, file: File) {
    setUploading(requirementId);
    setMessage('');
    const form = new FormData();
    form.set('file', file);
    form.set('documentTypeId', application.requirements.find((r) => r.id === requirementId)?.documentTypeId ?? '');
    const response = await fetch(`/api/documents?applicationId=${encodeURIComponent(application.id)}`, { method: 'POST', body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      setMessage(body.error ?? 'Upload failed. Please try again.');
      setUploading(null);
      return;
    }
    // The file is stored; decoding continues in the background. Show progress
    // and keep refreshing until the status settles.
    setUploading(null);
    setProcessing(true);
    setMessage('Uploaded. Processing your document…');
    router.refresh();
  }

  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-slate-900">Required documents</h2>
      <p className="mt-1 text-sm text-slate-600">
        Scan your licence disc barcode with the camera to capture your vehicle details. You can replace a document later.
      </p>
      {message ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">{message}</p> : null}

      <div className="mt-4 space-y-4">
        {application.requirements.map((requirement) => {
          const current = application.documents.find((doc) => doc.documentTypeId === requirement.documentTypeId);
          const isDisc = requirement.code === BARCODE_DOCUMENT_CODE;
          const busy = uploading === requirement.id;
          const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
            const file = event.target.files?.[0];
            if (file) void upload(requirement.id, file);
            event.target.value = '';
          };

          return (
            <div key={requirement.id} className="card">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="font-semibold text-slate-900">{requirement.displayName}</h3>
                  <p className="mt-1 text-sm text-slate-600">{requirement.description}</p>
                  {isDisc ? (
                    <p className="mt-1 text-xs text-slate-500">
                      Scanning reads your vehicle details directly from the disc.
                    </p>
                  ) : null}
                  <p className="mt-2 text-sm font-medium text-slate-700">
                    {!current
                      ? 'Not uploaded'
                      : current.status === 'UPLOADED' || current.status === 'PROCESSING'
                        ? 'Processing…'
                        : current.status === 'NEEDS_REVIEW'
                          ? 'Uploaded — needs review'
                          : `Uploaded: ${current.originalFileName}`}
                  </p>
                </div>

                {!isDisc ? (
                  <label className="btn-primary relative cursor-pointer">
                    {busy ? 'Uploading…' : current ? 'Replace file' : 'Choose file'}
                    <FileInput
                      accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf"
                      onChange={onFile}
                      disabled={uploading !== null}
                    />
                  </label>
                ) : null}
              </div>

              {isDisc ? (
                <div className="mt-4">
                  {scanning ? (
                    <BarcodeScanner
                      applicationId={application.id}
                      onDone={() => {
                        setScanning(false);
                        setMessage('Barcode scanned successfully.');
                      }}
                    />
                  ) : (
                    <button type="button" className="btn-primary" onClick={() => setScanning(true)}>
                      {current ? 'Rescan disc barcode' : 'Scan disc barcode'}
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
