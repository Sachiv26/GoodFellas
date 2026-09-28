'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    firstName: '',
    surname: '',
    email: '',
    mobileNumber: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body?.error ?? 'Registration failed. Please try again.');
        return;
      }
      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4 py-10">
      <h1 className="text-2xl font-bold text-slate-900">Create your account</h1>
      <p className="mt-1 text-sm text-slate-600">
        You need an account before starting an application.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label" htmlFor="firstName">First name</label>
            <input
              id="firstName"
              required
              autoComplete="given-name"
              className="input"
              value={form.firstName}
              onChange={(e) => update('firstName', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="surname">Surname</label>
            <input
              id="surname"
              required
              autoComplete="family-name"
              className="input"
              value={form.surname}
              onChange={(e) => update('surname', e.target.value)}
            />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            className="input"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="mobileNumber">Mobile number</label>
          <input
            id="mobileNumber"
            type="tel"
            required
            autoComplete="tel"
            placeholder="082 000 0000"
            className="input"
            value={form.mobileNumber}
            onChange={(e) => update('mobileNumber', e.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            minLength={10}
            autoComplete="new-password"
            className="input"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">At least 10 characters.</p>
        </div>

        {error ? (
          <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{error}</p>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={loading}>
          {loading ? 'Creating account…' : 'Register'}
        </button>
      </form>

      <p className="mt-6 text-sm text-slate-600">
        Already registered?{' '}
        <Link href="/login" className="font-medium text-slate-700 hover:underline">
          Sign in
        </Link>
      </p>
    </main>
  );
}
