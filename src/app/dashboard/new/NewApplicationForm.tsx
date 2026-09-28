'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CustomerProductDto } from '@/types/dto';
import { VEHICLE_CLASSES, DEFAULT_VEHICLE_CLASS, type VehicleClassValue } from '@/lib/validation';

export default function NewApplicationForm({ products }: { products: CustomerProductDto[] }) {
  const router = useRouter();
  const [productSlug, setProductSlug] = useState(products[0]?.slug ?? '');
  const [ownerType, setOwnerType] = useState<'INDIVIDUAL' | 'ORGANISATION'>('INDIVIDUAL');
  const [vehicleClass, setVehicleClass] = useState<VehicleClassValue>(DEFAULT_VEHICLE_CLASS);
  const [currentExpiryDate, setCurrentExpiryDate] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    const response = await fetch('/api/applications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productSlug, ownerType, vehicleClass, currentExpiryDate: currentExpiryDate || null }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setError(body.error ?? 'Could not create application.'); setLoading(false); return; }
    router.push(`/dashboard/${body.application.id}`);
    router.refresh();
  }

  return <form onSubmit={submit} className="card mt-6 space-y-4">
    <div><label className="label" htmlFor="product">Product</label><select id="product" className="input" value={productSlug} onChange={(e) => setProductSlug(e.target.value)} required>{products.map((product) => <option key={product.id} value={product.slug}>{product.name}</option>)}</select></div>
    <div><label className="label" htmlFor="ownerType">Owner type</label><select id="ownerType" className="input" value={ownerType} onChange={(e) => setOwnerType(e.target.value as typeof ownerType)}><option value="INDIVIDUAL">Individual</option><option value="ORGANISATION">Organisation</option></select></div>
    <div><label className="label" htmlFor="vehicleClass">Vehicle class</label><select id="vehicleClass" className="input" value={vehicleClass} onChange={(e) => setVehicleClass(e.target.value as VehicleClassValue)} required>{VEHICLE_CLASSES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><p className="mt-1 text-xs text-slate-500">Determines which TARE licence fee is charged for your vehicle.</p></div>
    <div><label className="label" htmlFor="expiry">Current licence expiry date</label><input id="expiry" className="input" type="date" value={currentExpiryDate} onChange={(e) => setCurrentExpiryDate(e.target.value)} /></div>
    {error ? <p className="rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{error}</p> : null}
    <button className="btn-primary w-full" disabled={loading || products.length === 0}>{loading ? 'Creating…' : 'Create application'}</button>
  </form>;
}
