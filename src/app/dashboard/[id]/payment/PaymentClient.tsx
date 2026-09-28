'use client';

import { useState } from 'react';

export default function PaymentClient({ applicationId, signed, documentsComplete, hasPrice, status }: { applicationId: string; signed: boolean; documentsComplete: boolean; hasPrice: boolean; status?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function pay() { setLoading(true); setError(''); const response = await fetch(`/api/applications/${applicationId}/payment`, { method: 'POST' }); const body = await response.json().catch(() => ({})); if (!response.ok) setError(body.error ?? 'Could not start payment.'); else if (body.checkoutUrl) window.location.href = body.checkoutUrl; else setError('Payment gateway is not configured yet. Add Ozow credentials to enable checkout.'); setLoading(false); }
  const eligible = signed && documentsComplete && hasPrice;
  return <div className="mt-6 space-y-4"><p className={`rounded-md px-3 py-2 text-sm ${eligible ? 'bg-slate-50 text-slate-800' : 'bg-slate-50 text-slate-800'}`}>{status === 'complete' ? 'Payment returned from gateway.' : eligible ? 'All required documents are processed and the proxy is signed. You can continue to payment.' : 'Payment is available after all documents are processed, a price is calculated, and the proxy is signed.'}</p>{error ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}<button type="button" className="btn-primary" onClick={pay} disabled={!eligible || loading}>{loading ? 'Opening gateway…' : 'Continue to payment'}</button></div>;
}
