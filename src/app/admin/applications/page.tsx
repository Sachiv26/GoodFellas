import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export default async function AdminApplicationsPage() {
  await requireRole(['ADMIN', 'SUPER_ADMIN']);
  const applications = await prisma.application.findMany({ include: { user: { select: { firstName: true, surname: true, email: true } }, product: { select: { name: true } }, _count: { select: { documents: true } } }, orderBy: { createdAt: 'desc' } });
  return <main className="mx-auto max-w-6xl px-4 py-10"><Link href="/admin" className="text-sm font-medium text-slate-700 hover:underline">← Admin dashboard</Link><h1 className="mt-4 text-3xl font-bold text-slate-900">Applications</h1><p className="mt-2 text-slate-600">Review customer applications and open an application for details.</p><div className="mt-6 space-y-4">{applications.length === 0 ? <div className="card text-sm text-slate-600">No applications found.</div> : applications.map((application) => <Link key={application.id} href={`/admin/applications/${application.id}`} className="card block transition-shadow hover:shadow-md"><div className="flex flex-col gap-3 sm:flex-row sm:justify-between"><div><p className="text-sm text-slate-500">{application.applicationNumber}</p><h2 className="mt-1 text-lg font-semibold text-slate-900">{application.product.name}</h2><p className="mt-1 text-sm text-slate-600">{application.user.firstName} {application.user.surname} · {application.user.email}</p></div><div className="flex flex-wrap gap-2 text-sm"><span className="badge bg-blue-100 text-slate-800">{application.status.replaceAll('_', ' ')}</span><span className="badge bg-slate-100 text-slate-700">{application._count.documents} documents</span></div></div></Link>)}</div></main>;
}