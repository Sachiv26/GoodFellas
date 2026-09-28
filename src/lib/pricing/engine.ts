/**
 * Pricing engine.
 *
 * Calculation is fully configuration driven:
 *   inputs -> rules (per component) -> lookup/amount resolution -> total
 *
 * The exact configuration version is recorded on every calculation so
 * historical prices remain reproducible after an admin edits pricing.
 *
 * Missing configuration NEVER produces a guessed amount — the component
 * contributes 0 and a warning is surfaced for admin review.
 */
import type {
  PricingCalculationResult,
  PricingComponentResult,
  PricingConfig,
  PricingInputs,
  PricingRuleConfig,
} from './types';
import type { PricingComponentKind } from '@prisma/client';
import { evaluateExpr, parseExpr, toNumber } from './expression';
import { resolveByKey, resolveByRange, resolveSumByKeys, type LookupResolution } from './lookup';

export function calculatePrice(
  config: PricingConfig,
  inputs: PricingInputs
): PricingCalculationResult {
  const context = buildContext(inputs);
  const components: PricingComponentResult[] = [];
  const warnings: string[] = [];
  let subtotal = 0;

  const componentOrder: Record<string, number> = { LICENCE_FEE: 10, ADMIN_FEE: 20, PENALTY: 30, ARREARS: 40, VAT: 100 };
  const orderedComponents = [...config.components].sort((a, b) => (componentOrder[a.code] ?? 50) - (componentOrder[b.code] ?? 50));
  for (const component of orderedComponents) {
    context.__subtotal__ = subtotal;
    context.overdueDays = overdueDays(inputs.currentExpiryDate, inputs.applicationDate);
    const sign = component.sign ?? 1;
    const rules = [...component.rules].sort((a, b) => b.priority - a.priority);
    for (const rule of rules) {
      const result = evaluateRule(
        component.code,
        component.label ?? component.name,
        component.kind,
        rule,
        config,
        context
      );
      warnings.push(...result.warnings);
      if (result.component.applied) {
        subtotal += result.component.amount * sign;
      }
      components.push(result.component);
    }
  }

  const total = roundCurrency(subtotal);
  return {
    version: config.version,
    currency: config.currency,
    inputs,
    components,
    subtotal: total,
    total,
    warnings: dedupe(warnings),
  };
}

interface RuleEvaluation {
  component: PricingComponentResult;
  warnings: string[];
}

function evaluateRule(
  componentCode: string,
  label: string,
  kind: PricingComponentKind,
  rule: PricingRuleConfig,
  config: PricingConfig,
  context: Record<string, unknown>
): RuleEvaluation {
  const base: PricingComponentResult = {
    componentCode,
    label: rule.name || label,
    kind,
    ruleCode: rule.code,
    ruleName: rule.name,
    amount: 0,
    applied: false,
    requiresReview: rule.requiresReview ?? false,
    reason: '',
  };

  const expr = parseExpr(rule.when);
  if (!evaluateExpr(expr, context)) {
    return {
      component: { ...base, reason: `Rule condition not met (${describeExpr(expr)})` },
      warnings: [],
    };
  }

  const resolved = resolveAmount(rule, config, context);
  const multiplier = rule.multiplier ?? 1;
  const amount = roundCurrency(resolved.amount * multiplier);
  if (!resolved.resolved) {
    return {
      component: {
        ...base,
        reason: `${rule.name}: configuration incomplete — no amount applied`,
        lookup: resolved.lookup,
      },
      warnings: resolved.warnings,
    };
  }

  return {
    component: {
      ...base,
      amount,
      applied: amount !== 0,
      reason: `Rule applied (${describeExpr(expr)})`,
      lookup: resolved.lookup,
    },
    warnings: resolved.warnings,
  };
}

interface AmountResolution extends LookupResolution {
  lookup?: { table: string; key?: string | null; range?: string | null };
}

function resolveAmount(
  rule: PricingRuleConfig,
  config: PricingConfig,
  context: Record<string, unknown>
): AmountResolution {
  const spec = rule.amount;
  switch (spec.type) {
    case 'fixed':
      return ok(spec.amount);
    case 'percentageOf': {
      const baseValue = toNumber(getContextPath(context, spec.path));
      if (baseValue === null) {
        return zero([`Percentage rule "${rule.name}" skipped — ${spec.path} is not available`]);
      }
      let amount = (baseValue * spec.rate) / 100;
      if (spec.min !== undefined) amount = Math.max(amount, spec.min);
      if (spec.max !== undefined) amount = Math.min(amount, spec.max);
      return ok(amount);
    }
    case 'percentageOfOverdueMonths': {
      const days = toNumber(getContextPath(context, 'overdueDays'));
      if (days === null || days <= 21) return zero([]);
      const months = Math.max(spec.minMonths ?? 1, Math.floor((days - 21) / 30) + 1);
      const baseValue = toNumber(getContextPath(context, '__subtotal__'));
      if (baseValue === null) return zero([`Overdue rule "${rule.name}" skipped — subtotal is not available`]);
      return ok(baseValue * (spec.rate / 100) * months);
    }
    case 'lookup': {
      const keyValue = getContextPath(context, spec.keyPath);
      const scopeValue = spec.rangePath ? getContextPath(context, spec.rangePath) : undefined;
      const resolution = resolveByKey(
        config.lookups,
        spec.table,
        keyValue === undefined || keyValue === null ? null : String(keyValue),
        scopeValue === undefined || scopeValue === null ? null : String(scopeValue)
      );
      return { ...resolution, lookup: { table: spec.table, key: resolution.entryKey } };
    }
    case 'lookupRange': {
      const value = toNumber(getContextPath(context, spec.rangePath));
      // Scope defaults to the vehicle type; fee tables override it via
      // `scopePath` (e.g. 'vehicle.vehicleClass' for the TARE licence fees)
      // so the priced column follows the class the customer selected.
      const scopeValue = getContextPath(context, spec.scopePath ?? 'vehicle.vehicleType');
      const resolution = resolveByRange(
        config.lookups,
        spec.table,
        value,
        scopeValue === undefined || scopeValue === null ? null : String(scopeValue)
      );
      return { ...resolution, lookup: { table: spec.table, range: resolution.range } };
    }
    case 'lookupSum': {
      const resolution = resolveSumByKeys(config.lookups, spec.table, spec.keys);
      return { ...resolution, lookup: { table: spec.table, range: resolution.entryLabel } };
    }
    default:
      return zero([`Unknown amount type on rule "${rule.name}" — needs configuration`]);
  }
}

function overdueDays(expiry: string | null, applicationDate: string): number {
  if (!expiry) return 0;
  const days = Math.floor((new Date(applicationDate).getTime() - new Date(expiry).getTime()) / 86_400_000);
  return Number.isFinite(days) ? Math.max(0, days) : 0;
}

function buildContext(inputs: PricingInputs): Record<string, unknown> {
  // Weights and vehicle identity are exposed both at top level and under
  // `vehicle` so rule authors can reference either path.
  return {
    ...inputs,
    vehicle: {
      vehicleType: inputs.vehicleType,
      vehicleClass: inputs.vehicleClass,
      tareWeight: inputs.tareWeight,
      gvm: inputs.gvm,
    },
    application: {
      applicationDate: inputs.applicationDate,
      currentExpiryDate: inputs.currentExpiryDate,
      ownerType: inputs.ownerType,
    },
    province: inputs.province,
    municipality: inputs.municipality,
  };
}

function getContextPath(context: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  if (!path.includes('.')) return context[path];
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, context);
}

function ok(amount: number): AmountResolution {
  return {
    amount,
    entryKey: null,
    entryLabel: null,
    range: null,
    resolved: true,
    warnings: [],
  };
}

function zero(warnings: string[]): AmountResolution {
  return {
    amount: 0,
    entryKey: null,
    entryLabel: null,
    range: null,
    resolved: false,
    warnings,
  };
}

export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function describeExpr(expr: unknown): string {
  if (!expr || typeof expr !== 'object') return 'always';
  const node = expr as Record<string, unknown>;
  const op = String(node.op ?? 'always');
  const path = node.path ? String(node.path) : '';
  const value = node.value !== undefined ? JSON.stringify(node.value) : '';
  return [op, path, value].filter(Boolean).join(' ');
}

