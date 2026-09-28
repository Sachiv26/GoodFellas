/**
 * Customer-facing price breakdown for the payment page.
 *
 * Renders the line items persisted on the latest `PriceCalculation` so the
 * customer can see exactly what they are paying for before opening the
 * gateway. Labels and amounts come from the pricing configuration — nothing
 * about a fee is hard-coded here.
 */
import { formatAmount, parsePriceBreakdown } from '@/lib/pricing/breakdown';

export default function PriceBreakdown({ breakdown, total, currency }: { breakdown: unknown; total: unknown; currency?: string | null }) {
  const view = parsePriceBreakdown(breakdown, typeof total === 'number' ? total : Number(total), currency ?? 'ZAR');
  if (view.lines.length === 0 && !view.adjustment) return null;
  return <section className="card mt-6" aria-labelledby="price-breakdown-heading"><h2 id="price-breakdown-heading" className="text-sm font-semibold text-slate-900">What you are paying for</h2><dl className="mt-3 divide-y divide-slate-200">{view.lines.map((line) => <div key={line.key} className="flex items-start justify-between gap-4 py-2"><div className="min-w-0"><dt className="text-sm text-slate-800">{line.label}</dt>{line.note ? <p className="mt-0.5 text-xs text-slate-500">{line.note}</p> : null}{line.requiresReview ? <p className="mt-0.5 text-xs text-amber-700">Pending review</p> : null}</div><dd className="shrink-0 text-sm font-medium text-slate-900">{formatAmount(line.amount, view.currency)}</dd></div>)}{view.adjustment ? <div className="flex items-start justify-between gap-4 py-2"><div className="min-w-0"><dt className="text-sm text-slate-800">{view.adjustment.label}</dt>{view.adjustment.note ? <p className="mt-0.5 text-xs text-slate-500">{view.adjustment.note}</p> : null}</div><dd className="shrink-0 text-sm font-medium text-slate-900">{formatAmount(view.adjustment.amount, view.currency)}</dd></div> : null}</dl><div className="mt-3 flex items-baseline justify-between border-t border-slate-300 pt-3"><p className="text-sm font-medium text-slate-700">Total due</p><p className="text-lg font-bold text-slate-900">{formatAmount(view.total, view.currency)}</p></div>{view.warnings.length > 0 ? <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600"><p className="font-medium text-slate-700">Pricing notes</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{view.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div> : null}</section>;
}
