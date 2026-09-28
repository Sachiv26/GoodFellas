'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function ProxyButton({ applicationId, initialDocumentId = null }: { applicationId: string; initialDocumentId?: string | null }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [documentId, setDocumentId] = useState<string | null>(initialDocumentId);
  const [viewerKey, setViewerKey] = useState(0);
  const [signature, setSignature] = useState('');
  async function create() { setLoading(true); setError(''); const response = await fetch(`/api/applications/${applicationId}/proxy`, { method: 'POST' }); const body = await response.json().catch(() => ({})); if (!response.ok) setError(body.error ?? 'Could not create proxy PDF.'); else setDocumentId(body.document.id); setLoading(false); }
  async function sign() { if (!documentId) return; setLoading(true); setError(''); const response = await fetch(`/api/applications/${applicationId}/proxy/${documentId}/sign`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature }) }); const body = await response.json().catch(() => ({})); if (!response.ok) setError(body.error ?? 'Could not sign proxy PDF.'); else { setViewerKey((value) => value + 1); router.refresh(); } setLoading(false); }
  return <section className="card mt-8 border-slate-200 bg-white"><h2 className="text-lg font-semibold text-slate-900">Give proxy</h2><p className="mt-1 text-sm text-slate-600">Open the private proxy authorisation, review the populated details, and add your signature. Witness details remain blank.</p>{error ? <p className="mt-3 text-sm font-medium text-slate-700">{error}</p> : null}<div className="mt-4 flex flex-wrap items-center gap-3"><button type="button" className="btn-primary" onClick={create} disabled={loading}>{loading ? 'Preparing…' : 'Give proxy'}</button>{documentId ? <div className="mt-4 w-full space-y-3"><a className="btn-secondary inline-flex" href={`/api/applications/${applicationId}/proxy/${documentId}`} target="_blank" rel="noreferrer">Open proxy PDF in new tab</a><iframe title="Proxy authorisation PDF" className="h-[720px] w-full rounded-lg border border-slate-200 bg-white" src={`/api/applications/${applicationId}/proxy/${documentId}?v=${viewerKey}`} /><div className="flex flex-wrap items-center gap-3"><input className="input max-w-xs" aria-label="Your signature" placeholder="Type your full name as signature" value={signature} onChange={(event) => setSignature(event.target.value)} /><button type="button" className="btn-secondary" onClick={sign} disabled={loading || !signature.trim()}>Apply signature</button></div></div> : null}</div></section>;
}
