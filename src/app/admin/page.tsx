import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePageRole } from '@/lib/auth/session';
import LogoutButton from './LogoutButton';

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  const session = await requirePageRole(['ADMIN', 'SUPER_ADMIN'], '/admin');
  const [userCount, applicationCount, documentCount, pendingDocumentCount] = await Promise.all([
    prisma.user.count(), prisma.application.count(), prisma.document.count(), prisma.document.count({ where: { status: 'NEEDS_REVIEW' } }),
  ]);
  const sections = [
    { title: 'Applications', description: 'Review and manage customer applications.', href: '/admin/applications' },
    { title: 'Customers', description: 'Manage registered customers and account access.', href: '/admin/customers' },
    { title: 'Documents', description: 'Review uploaded documents and processing status.', href: '/admin/documents' },
    { title: 'Products', description: 'Configure products and document requirements.', href: '/admin/products' },
  ];
  return <main className="mx-auto max-w-6xl px-4 py-10"><header className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-medium uppercase tracking-wide text-slate-700">Administration</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">Admin dashboard</h1><p className="mt-2 text-slate-600">Signed in as {session.email}</p></div><div className="flex flex-wrap items-center gap-2"><Link href="/" className="btn-secondary">Back to home</Link><LogoutButton /></div></header><section aria-label="Summary" className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"><div className="card"><p className="text-sm text-slate-500">Users</p><p className="mt-2 text-3xl font-bold text-slate-900">{userCount}</p></div><div className="card"><p className="text-sm text-slate-500">Applications</p><p className="mt-2 text-3xl font-bold text-slate-900">{applicationCount}</p></div><div className="card"><p className="text-sm text-slate-500">Documents</p><p className="mt-2 text-3xl font-bold text-slate-900">{documentCount}</p></div><div className="card"><p className="text-sm text-slate-500">Needs review</p><p className="mt-2 text-3xl font-bold text-slate-700">{pendingDocumentCount}</p></div></section><section className="mt-10"><h2 className="text-lg font-semibold text-slate-900">Management areas</h2><div className="mt-4 grid gap-4 sm:grid-cols-2">{sections.map((section) => <Link key={section.title} href={section.href} className="card transition-shadow hover:shadow-md"><h3 className="font-semibold text-slate-900">{section.title}</h3><p className="mt-1 text-sm text-slate-600">{section.description}</p><p className="mt-3 text-sm font-medium text-slate-700">Open â†’</p></Link>)}</div></section></main>;
}