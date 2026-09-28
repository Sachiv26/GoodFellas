import Link from 'next/link';
import { listProducts } from '@/server/services/application-service';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let products: Awaited<ReturnType<typeof listProducts>> = [];
  try {
    products = await listProducts();
  } catch {
    products = [];
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <header className="mb-10">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">
          Document Processing Platform
        </h1>
        <p className="mt-2 text-slate-600">
          Renew your vehicle licence and other South African documents — upload
          your documents, we handle the paperwork.
        </p>
      </header>

      <section className="mb-10 grid gap-4 sm:grid-cols-2">
        <Link
          href="/login"
          className="btn-primary h-11"
        >
          Sign in
        </Link>
        <Link href="/register" className="btn-secondary h-11">
          Create an account
        </Link>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-slate-800">Available services</h2>
        {products.length === 0 ? (
          <p className="card text-sm text-slate-500">
            No products are configured yet. Run the database seed to load the
            Vehicle Licence Renewal product.
          </p>
        ) : (
          <div className="grid gap-4">
            {products.map((product) => (
              <div key={product.id} className="card">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="font-semibold text-slate-900">{product.name}</h3>
                    <p className="mt-1 text-sm text-slate-600">{product.description}</p>
                  </div>
                  <span className="badge bg-slate-100 text-slate-800">
                    v{product.version}
                  </span>
                </div>
                <div className="mt-3">
                  <Link href="/dashboard" className="text-sm font-medium text-slate-700 hover:underline">
                    Start an application →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <footer className="mt-16 border-t border-slate-200 pt-6 text-xs text-slate-500">
        Application forms are processed by authorised administrators only.
      </footer>
    </main>
  );
}
