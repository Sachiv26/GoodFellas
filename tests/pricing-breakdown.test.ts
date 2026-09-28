import { describe, expect, it } from '@jest/globals';
import { formatAmount, parsePriceBreakdown } from '@/lib/pricing/breakdown';

const breakdown = {
  components: [
    { componentCode: 'LICENCE_FEE', label: 'Licence fee (tare 1200kg)', kind: 'BASE', ruleCode: 'TARE', ruleName: 'Licence fee (tare 1200kg)', amount: 528, applied: true, requiresReview: false, reason: '' },
    { componentCode: 'ADMIN_FEE', label: 'Service fee', kind: 'SERVICE', ruleCode: 'ADMIN', ruleName: 'Service fee', amount: 60, applied: true, requiresReview: false, reason: '' },
    { componentCode: 'PENALTY', label: 'Late licensing', kind: 'PENALTY', ruleCode: 'LATE', ruleName: 'Late licensing', amount: 0, applied: false, requiresReview: false, reason: 'Rule condition not met (gt overdueDays 21)' },
  ],
  subtotal: 588,
  total: 588,
  warnings: ['Late licensing rule needs configuration'],
};

describe('price breakdown', () => {
  it('lists applied, non-zero rules as line items', () => {
    const view = parsePriceBreakdown(breakdown, 588);
    expect(view.lines.map((l) => l.label)).toEqual(['Licence fee (tare 1200kg)', 'Service fee']);
    expect(view.lines.map((l) => l.componentCode)).toEqual(['LICENCE_FEE', 'ADMIN_FEE']);
    expect(view.subtotal).toBe(588);
    expect(view.total).toBe(588);
    expect(view.adjustment).toBeNull();
  });

  it('excludes rules that did not apply', () => {
    const view = parsePriceBreakdown(breakdown, 588);
    expect(view.lines.some((l) => l.componentCode === 'PENALTY')).toBe(false);
  });

  it('surfaces a residual as an adjustment so lines reconcile to the total', () => {
    const view = parsePriceBreakdown({ ...breakdown, total: 500 }, 500);
    expect(view.subtotal).toBe(588);
    expect(view.adjustment?.amount).toBe(-88);
    expect(view.total).toBe(500);
    expect(view.lines.reduce((s, l) => s + l.amount, 0) + (view.adjustment?.amount ?? 0)).toBe(view.total);
  });

  it('accepts a Prisma Decimal total', () => {
    const view = parsePriceBreakdown(breakdown, { toString: () => '588.00' } as unknown as number, 'ZAR');
    expect(view.total).toBe(588);
  });

  it('returns an empty view for missing or malformed breakdown JSON', () => {
    expect(parsePriceBreakdown(null, 100).lines).toEqual([]);
    expect(parsePriceBreakdown('nope', 100).total).toBe(100);
    expect(parsePriceBreakdown({ components: 'bad' }, 100).lines).toEqual([]);
  });

  it('formats amounts with grouping and the ZAR symbol', () => {
    expect(formatAmount(1234.5)).toBe('R 1 234.50');
    expect(formatAmount(-88)).toBe('-R 88.00');
    expect(formatAmount(10, 'USD')).toBe('USD 10.00');
  });
});
