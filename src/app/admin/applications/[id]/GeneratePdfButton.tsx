'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function GeneratePdfButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  async function generate() { setLoading(true); setError(''); const response = await fetch(`/api/admin/applications/${applicationId}/pdf`, { method: 'POST' }); const body = await response.json().catch(() => ({})); if (!response.ok) setError(body.error ?? 'Could not generate PDF.'); else router.refresh(); setLoading(false); }
  return <div className="flex flex-wrap items-center gap-3"><button type="button" className="btn-primary" onClick={generate} disabled={loading}>{loading ? 'Generating…' : 'Generate populated PDF'}</button>{error ? <span className="text-sm text-slate-700">{error}</span> : null}</div>;
}