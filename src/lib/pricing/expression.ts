/**
 * Safe rule-expression evaluation.
 *
 * Rules are stored as JSON in PricingRule.expr and evaluated here with a tiny
 * pure interpreter — no eval(), no Function(), no dynamic code execution. This
 * keeps pricing configuration admin-editable without exposing a code-injection
 * surface.
 */
import type { PricingExpr } from './types';

export function getPath(source: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc === null || acc === undefined) return undefined;
    if (typeof acc !== 'object') return undefined;
    return (acc as Record<string, unknown>)[key];
  }, source);
}

export function evaluateExpr(expr: PricingExpr, context: Record<string, unknown>): boolean {
  switch (expr.op) {
    case 'always':
      return true;
    case 'and':
      return expr.args.every((arg) => evaluateExpr(arg, context));
    case 'or':
      return expr.args.some((arg) => evaluateExpr(arg, context));
    case 'not':
      return !evaluateExpr(expr.arg, context);
    case 'exists': {
      const value = getPath(context, expr.path);
      return value !== null && value !== undefined && value !== '';
    }
    case 'missing': {
      const value = getPath(context, expr.path);
      return value === null || value === undefined || value === '';
    }
    case 'eq':
      return compareEquality(getPath(context, expr.path), expr.value);
    case 'neq':
      return !compareEquality(getPath(context, expr.path), expr.value);
    case 'in': {
      const value = coerceString(getPath(context, expr.path));
      return value !== null && expr.value.map((v) => String(v).toLowerCase()).includes(value.toLowerCase());
    }
    case 'notIn': {
      const value = coerceString(getPath(context, expr.path));
      if (value === null) return true;
      return !expr.value.map((v) => String(v).toLowerCase()).includes(value.toLowerCase());
    }
    case 'gt':
      return numericCompare(getPath(context, expr.path), expr.value, (a, b) => a > b);
    case 'gte':
      return numericCompare(getPath(context, expr.path), expr.value, (a, b) => a >= b);
    case 'lt':
      return numericCompare(getPath(context, expr.path), expr.value, (a, b) => a < b);
    case 'lte':
      return numericCompare(getPath(context, expr.path), expr.value, (a, b) => a <= b);
    case 'daysBetween': {
      const left = parseDate(getPath(context, expr.path));
      const right = parseDate(getPath(context, expr.compareTo));
      if (!left || !right) return false;
      const days = Math.floor((left.getTime() - right.getTime()) / 86_400_000);
      switch (expr.comparator) {
        case 'gt':
          return days > expr.value;
        case 'gte':
          return days >= expr.value;
        case 'lt':
          return days < expr.value;
        case 'lte':
          return days <= expr.value;
        case 'eq':
          return days === expr.value;
        default:
          return false;
      }
    }
    default: {
      // Unknown operator from configuration: treat as not applicable rather
      // than throwing, so one bad rule cannot break the whole calculation.
      return false;
    }
  }
}

export function parseExpr(raw: unknown): PricingExpr {
  if (typeof raw === 'string') {
    try {
      return parseExpr(JSON.parse(raw));
    } catch {
      return { op: 'always' };
    }
  }
  if (raw && typeof raw === 'object' && 'op' in (raw as Record<string, unknown>)) {
    return raw as PricingExpr;
  }
  return { op: 'always' };
}

function compareEquality(actual: unknown, expected: string | number | boolean | null): boolean {
  if (expected === null) return actual === null || actual === undefined || actual === '';
  if (typeof expected === 'boolean') return Boolean(actual) === expected;
  if (typeof expected === 'number') {
    const numeric = toNumber(actual);
    return numeric !== null && numeric === expected;
  }
  const asString = coerceString(actual);
  return asString !== null && asString.toLowerCase() === expected.toLowerCase();
}

function numericCompare(
  actual: unknown,
  expected: string | number | boolean | null,
  comparator: (a: number, b: number) => boolean
): boolean {
  const a = toNumber(actual);
  const b = toNumber(expected);
  if (a === null || b === null) return false;
  return comparator(a, b);
}

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[^0-9.\-]/g, '');
    if (!cleaned) return null;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.trim() === '' ? null : value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString();
  return null;
}

function parseDate(value: unknown): Date | null {
  const str = coerceString(value);
  if (!str) return null;
  const date = new Date(str);
  return Number.isNaN(date.getTime()) ? null : date;
}
