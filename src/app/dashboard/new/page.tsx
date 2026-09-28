import Link from 'next/link';
import { requireAuth } from '@/lib/auth/session';
import { listProducts } from '@/server/services/application-service';
import NewApplicationForm from './NewApplicationForm';

export const dynamic = 'force-dynamic';

export default async function NewApplicationPage() {
  await requireAuth();
  const products = await listProducts();
  return <main className="mx-auto max-w-2xl px-4 py-10"><Link href="/dashboard" className="text-sm font-medium text-slate-700 hover:underline">← Back to applications</Link><h1 className="mt-4 text-3xl font-bold text-slate-900">Start an application</h1><p className="mt-2 text-slate-600">Choose a configured product to begin.</p><NewApplicationForm products={products} /></main>;
}
