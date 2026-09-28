'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * "Give proxy" control.
 *
 * The PDF is rendered inline with an <object> element, which uses the browser's
 * built-in PDF plugin. Two details matter for it to work at all:
 *
 *  - The `key` is bumped after signing so the frame reloads. Without it the
 *    browser keeps showing the pre-signature copy from its cache.
 *  - The `type` attribute is set explicitly; some browsers will download rather
 *    than render a PDF served without a declared MIME type.
 *
 * A direct "open in new tab" link is kept alongside, because the embedded
 * viewer is unavailable on some mobile browsers and must never be the only way
 * to read a signed authorisation.
 */
export default function ProxyButton({ applicationId, initialDocumentId = null }: { applicationId: string; initialDocumentId?: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId);
  const [signature, setSignature] = useState('');
  const [viewerKey, setViewerKey] = useState(0);
  const [showViewer, setShowViewer] = useState(false);

  const pdfUrl = documentId
    ? `/api/applications/${applicationId}/proxy/${documentId}?v=${viewerKey}`
    : null;

  // Force a re-fetch of the object element after the signature is applied.
  const reloadViewer = useCallback(() => {
    setViewerKey((value) => value + 1);
    setShowViewer(false);
    // Re-mount on the next frame so the element re-fetches rather than
    // serving the stale copy from the browser's PDF cache.
    requestAnimationFrame(() => setShowViewer(true));
  }, []);

  async function create() {
    setLoading(true);
    setError('');
    const response = await fetch(`/api/applications/${applicationId}/proxy`, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? 'Could not create proxy PDF.');
    else {
      setDocumentId(body.document.id);
      setShowViewer(true);
    }
    setLoading(false);
  }

  async function sign() {
    if (!documentId) return;
    setLoading(true);
    setError('');
    const response = await fetch(`/api/applications/${applicationId}/proxy/${documentId}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signature }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? 'Could not sign proxy PDF.');
    else {
      reloadViewer();
      router.refresh();
    }
    setLoading(false);
  }

  return (
    <section className="card mt-8 border-slate-200 bg-white">
      <h2 className="text-lg font-semibold text-slate-900">Give proxy</h2>
      <p className="mt-1 text-sm text-slate-600">
        Open the private proxy authorisation, review the populated details, and add your signature. Witness details remain blank.
      </p>
      {error ? <p className="mt-3 text-sm font-medium text-rose-700">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={create} disabled={loading}>
          {loading ? 'Preparing…' : 'Give proxy'}
        </button>
        {documentId ? (
          <a className="btn-secondary inline-flex" href={pdfUrl!} target="_blank" rel="noreferrer">
            Open proxy PDF in new tab
          </a>
        ) : null}
      </div>

      {documentId && showViewer ? (
        <div className="mt-4 space-y-3">
          <object
            key={viewerKey}
            data={pdfUrl!}
            type="application/pdf"
            className="h-[720px] w-full rounded-lg border border-slate-200 bg-white"
          >
            {/* Rendered when the browser has no built-in PDF viewer. */}
            <p className="p-4 text-sm text-slate-700">
              Your browser cannot display the PDF inline.{' '}
              <a className="font-medium underline" href={pdfUrl!} target="_blank" rel="noreferrer">
                Open it in a new tab
              </a>
              .
            </p>
          </object>
          <p className="text-xs text-slate-500">
            If the document appears blank, use the new tab link above to open it directly.
          </p>
        </div>
      ) : null}

      {documentId ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            className="input max-w-xs"
            aria-label="Your signature"
            placeholder="Type your full name as signature"
            value={signature}
            onChange={(event) => setSignature(event.target.value)}
          />
          <button type="button" className="btn-secondary" onClick={sign} disabled={loading || !signature.trim()}>
            Apply signature
          </button>
        </div>
      ) : null}
    </section>
  );
}
