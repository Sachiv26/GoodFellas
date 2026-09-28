import Link from 'next/link';

export default function AppMenu() { return <nav aria-label="Main navigation" className="mb-6 flex flex-wrap gap-2 border-b border-slate-200 pb-4"><Link className="btn-secondary" href="/dashboard">Applications</Link><Link className="btn-secondary" href="/dashboard/new">New application</Link><Link className="btn-secondary" href="/">Home</Link></nav>; }
