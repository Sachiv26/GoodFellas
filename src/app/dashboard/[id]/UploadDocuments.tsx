'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerApplicationDetailDto } from '@/types/dto';

/**
 * The licence disc is captured for its barcode, so it offers a dedicated
 * "Scan disc barcode" camera action. The ID and proof of residence are text
 * documents and are uploaded as files only.
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
function FileInput({ capture, accept, onChange, disabled }: { capture?: boolean; accept: string; onChange: React.ChangeEventHandler<HTMLInputElement>; disabled: boolean }) {
  return <input type="file" accept={accept} {...(capture ? { capture: 'environment' } : {})} disabled={disabled} onChange={onChange} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />;
}

export default function UploadDocuments({ application }: { application: CustomerApplicationDetailDto }) {
  const router = useRouter();
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  async function upload(requirementId: string, file: File) {
    setUploading(requirementId); setMessage('');
    const form = new FormData(); form.set('file', file); form.set('documentTypeId', application.requirements.find((r) => r.id === requirementId)?.documentTypeId ?? '');
    const response = await fetch(`/api/documents?applicationId=${encodeURIComponent(application.id)}`, { method: 'POST', body: form });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) setMessage(body.error ?? 'Upload failed. Please try again.'); else { setMessage('Document uploaded successfully.'); router.refresh(); }
    setUploading(null);
  }
  return <section className="mt-8"><h2 className="text-lg font-semibold text-slate-900">Required documents</h2><p className="mt-1 text-sm text-slate-600">Choose a JPG, PNG, or PDF file. You can replace a document later.</p>{message ? <p className="mt-4 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-800">{message}</p> : null}<div className="mt-4 space-y-4">{application.requirements.map((requirement) => { const current = application.documents.find((doc) => doc.documentTypeId === requirement.documentTypeId); const isDisc = requirement.code === BARCODE_DOCUMENT_CODE; const busy = uploading === requirement.id; const onFile = (event: React.ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; if (file) void upload(requirement.id, file); event.target.value = ''; }; return <div key={requirement.id} className="card"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="font-semibold text-slate-900">{requirement.displayName}</h3><p className="mt-1 text-sm text-slate-600">{requirement.description}</p>{isDisc ? <p className="mt-1 text-xs text-slate-500">Opens the camera on a phone. On a computer, choose a photo file instead.</p> : null}<p className="mt-2 text-sm font-medium text-slate-700">{current ? `Uploaded: ${current.originalFileName}` : 'Not uploaded'}</p></div><div className="flex flex-wrap gap-2">{isDisc ? <><label className="btn-primary relative cursor-pointer">{busy ? 'Scanning\u2026' : current ? 'Rescan disc barcode' : 'Scan disc barcode'}<FileInput capture accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={onFile} disabled={uploading !== null} /></label><label className="btn-secondary relative cursor-pointer">{busy ? 'Uploading\u2026' : current ? 'Replace photo' : 'Choose photo'}<FileInput accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={onFile} disabled={uploading !== null} /></label></> : <label className="btn-primary relative cursor-pointer">{busy ? 'Uploading\u2026' : current ? 'Replace file' : 'Choose file'}<FileInput accept="image/jpeg,image/png,application/pdf,.jpg,.jpeg,.png,.pdf" onChange={onFile} disabled={uploading !== null} /></label>}</div></div></div>; })}</div></section>;
}
