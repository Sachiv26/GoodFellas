'use client';

import { useState } from 'react';

/**
 * Payment control.
 *
 * The button is ALWAYS enabled and always visible. It used to be disabled until
 * every document was processed, the proxy was signed and a price existed, which
 * hid the control rather than explaining the blocker. Eligibility is still
 * enforced server-side by `createPaymentAttempt`; this component only explains
 * the current state and surfaces the server's refusal if there is one.
 */
export default function PaymentClient({ applicationId, signed, documentsComplete, hasPrice, status }: { applicationId: string; signed: boolean; documentsComplete: boolean; hasPrice: boolean; status?: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function pay() {
    setLoading(true);
    setError('');
    const response = await fetch(`/api/applications/${applicationId}/payment`, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setError(body.error ?? 'Could not start payment.');
    else if (body.checkoutUrl) window.location.href = body.checkoutUrl;
    else setError('Payment gateway is not configured yet. Add Ozow credentials to enable checkout.');
    setLoading(false);
  }

  const blockers: string[] = [];
  if (!documentsComplete) blockers.push('all documents are processed');
  if (!signed) blockers.push('the proxy is signed');
  if (!hasPrice) blockers.push('a price is calculated');

  return (
    <div className="mt-6 space-y-4">
      <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">
        {status === 'complete'
          ? 'Payment returned from gateway.'
          : blockers.length
            ? `Payment can be started once ${blockers.join(', ')}.`
            : 'All requirements are met. You can continue to payment.'}
      </p>
      {error ? <p className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}
      <button type="button" className="btn-primary" onClick={pay} disabled={loading}>
        {loading ? 'Opening gateway…' : 'Continue to payment'}
      </button>
    </div>
  );
}
