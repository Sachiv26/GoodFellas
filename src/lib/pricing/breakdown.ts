/**
 * Price breakdown presentation.
 *
 * `PriceCalculation.breakdown` is stored as raw engine output (JSON) so a
 * calculation stays reproducible. This module turns that JSON into safe,
 * display-ready line items for the customer payment page:
 *
 *   - untrusted JSON is validated field by field (never cast blindly)
 *   - rules that did not apply are excluded from the payable lines
 *   - discounts are not guessed: the engine records a signed subtotal but
 *     stores unsigned rule amounts, so any residual between the applied rules
 *     and the stored total is surfaced explicitly as an adjustment line
 *   - configuration labels/amounts stay in the database, nothing is hard-coded
 */
import { roundCurrency } from './engine';

/** A single payable line on the customer invoice. */
export interface PriceLineItem {
  /** Stable key for React lists. */
  key: string;
  componentCode: string;
  /** Human label from the pricing configuration. */
  label: string;
  ruleName: string;
  kind: string;
  amount: number;
  /** Amounts the engine flagged for admin review before use. */
  requiresReview: boolean;
  /** Optional engine explanation (why the rule did not apply, lookup used, …). */
  note: string | null;
}

export interface PriceBreakdownView {
  /** Applied, non-zero rules that make up the price. */
  lines: PriceLineItem[];
  /** Residual between the applied rules and the stored total (discounts). */
  adjustment: PriceLineItem | null;
  /** Sum of `lines` only. */
  subtotal: number;
  /** Authoritative total — the amount actually due. */
  total: number;
  currency: string;
  warnings: string[];
}

const EMPTY_VIEW: PriceBreakdownView = {
  lines: [],
  adjustment: null,
  subtotal: 0,
  total: 0,
  currency: 'ZAR',
  warnings: [],
};

/**
 * Parse the stored `breakdown` JSON into a display view.
 *
 * @param raw       `PriceCalculation.breakdown` (unknown — untrusted)
 * @param total     authoritative total from the calculation row (Decimal)
 * @param currency  authoritative currency from the calculation row
 */
export function parsePriceBreakdown(
  raw: unknown,
  total?: number,
  currency = 'ZAR'
): PriceBreakdownView {
  const record = asRecord(raw);
  if (!record) return { ...EMPTY_VIEW, total: toAmount(total) ?? 0, currency };

  const lines = asArray(record.components)
    .map(toLineItem)
    .filter((line): line is PriceLineItem => line !== null)
    .filter((line) => line.amount !== 0);

  const subtotal = roundCurrency(lines.reduce((sum, line) => sum + line.amount, 0));
  const storedTotal = toAmount(record.total) ?? toAmount(total) ?? subtotal;
  const authoritativeTotal = toAmount(total) ?? storedTotal;

  return {
    lines,
    adjustment: buildAdjustment(lines, subtotal, authoritativeTotal),
    subtotal,
    total: authoritativeTotal,
    currency: asText(record.currency) ?? currency,
    warnings: asArray(record.warnings).map(asText).filter((w): w is string => w !== null),
  };
}

/**
 * Discount components carry `sign: -1` in configuration, but the engine stores
 * the unsigned rule amount and applies the sign to the subtotal only. Rather
 * than guessing which line is a discount, any difference is reported as one
 * explicit adjustment line so the lines always reconcile to the amount due.
 */
function buildAdjustment(
  lines: PriceLineItem[],
  subtotal: number,
  total: number
): PriceLineItem | null {
  const difference = roundCurrency(total - subtotal);
  if (difference === 0) return null;
  return {
    key: 'adjustment',
    componentCode: 'ADJUSTMENT',
    label: 'Discounts and adjustments',
    ruleName: 'Adjustment',
    kind: 'ADJUSTMENT',
    amount: difference,
    requiresReview: false,
    note: 'Applied by the pricing configuration.',
  };
}

function toLineItem(component: unknown, index: number): PriceLineItem | null {
  const record = asRecord(component);
  if (!record) return null;
  const componentCode = asText(record.componentCode);
  if (!componentCode) return null;
  const ruleCode = asText(record.ruleCode);
  return {
    key: `${componentCode}:${ruleCode ?? index}`,
    componentCode,
    label: asText(record.label) ?? asText(record.ruleName) ?? componentCode,
    ruleName: asText(record.ruleName) ?? asText(record.label) ?? componentCode,
    kind: asText(record.kind) ?? 'FEE',
    amount: toAmount(record.amount) ?? 0,
    requiresReview: record.requiresReview === true,
    note: asText(record.reason),
  };
}

/**
 * Format an amount for display, e.g. `R 1 234.50`.
 *
 * Grouping is done manually rather than via `toLocaleString` so the output is
 * identical on the server and in the browser regardless of the host locale
 * (ICU builds render `1 234,50` for en-ZA, which does not match the format
 * already used elsewhere in the app).
 */
export function formatAmount(amount: number, currency = 'ZAR'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const [whole, fraction] = Math.abs(safe).toFixed(2).split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${safe < 0 ? '-' : ''}${currencySymbol(currency)}${grouped}.${fraction}`;
}

function currencySymbol(currency: string): string {
  return currency.toUpperCase() === 'ZAR' ? 'R ' : `${currency.toUpperCase()} `;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** JSON numbers and Prisma Decimals both arrive as number-ish values. */
function toAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object' && 'toString' in value) {
    const parsed = Number(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
