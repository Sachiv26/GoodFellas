/**
 * Pricing repository — loads the pricing configuration from the database and
 * maps it into the pure engine types. Nothing about fees lives in code: the
 * repository only reshapes rows.
 */
import type { PricingComponentKind, PricingRule } from '@prisma/client';
import { prisma } from '@/lib/db';
import type {
  PricingAmountSpec,
  PricingComponentConfig,
  PricingConfig,
  PricingExpr,
  PricingLookupEntryConfig,
  PricingLookupTableConfig,
  PricingRuleConfig,
} from '@/lib/pricing/types';

interface StoredRulePayload {
  code?: string;
  when?: unknown;
  amount?: unknown;
  multiplier?: number;
  requiresReview?: boolean;
}

const FALLBACK_AMOUNT: PricingAmountSpec = { type: 'fixed', amount: 0 };

export interface LoadPricingOptions {
  productId: string;
  /** Only rules effective on/at this date are used (defaults to now). */
  effectiveAt?: Date;
}

export async function loadPricingConfig(options: LoadPricingOptions): Promise<PricingConfig> {
  const effectiveAt = options.effectiveAt ?? new Date();

  const [components, tables] = await Promise.all([
    prisma.pricingComponent.findMany({
      where: { productId: options.productId, active: true },
      include: { rules: true },
      orderBy: { code: 'asc' },
    }),
    prisma.pricingLookupTable.findMany({
      where: { active: true },
      include: { entries: { where: { active: true }, orderBy: { key: 'asc' } } },
      orderBy: { code: 'asc' },
    }),
  ]);

  const configVersions = components.map((c) => c.version);
  const version = configVersions.length ? Math.max(...configVersions) : 1;

  const componentConfigs: PricingComponentConfig[] = components.map((component) => ({
    code: component.code,
    name: component.name,
    kind: component.kind as PricingComponentKind,
    label: component.label,
    rules: component.rules
      .filter((rule) => isRuleEffective(rule, effectiveAt))
      .map(toRuleConfig),
  }));

  const lookupConfigs: PricingLookupTableConfig[] = tables.map((table) => ({
    code: table.code,
    name: table.name,
    description: table.description ?? undefined,
    entries: table.entries.map(toLookupEntry),
  }));

  return {
    version,
    currency: 'ZAR',
    effectiveFrom: effectiveAt.toISOString().slice(0, 10),
    lookups: lookupConfigs,
    components: componentConfigs,
  };
}

function isRuleEffective(rule: PricingRule, at: Date): boolean {
  if (!rule.active) return false;
  if (rule.effectiveFrom > at) return false;
  if (rule.effectiveTo && rule.effectiveTo < at) return false;
  return true;
}

function toRuleConfig(rule: PricingRule): PricingRuleConfig {
  const payload = parseRulePayload(rule.expr);
  return {
    code: payload.code ?? rule.name,
    name: rule.name,
    when: (payload.when ?? { op: 'always' }) as PricingExpr,
    amount: (payload.amount ?? FALLBACK_AMOUNT) as PricingAmountSpec,
    priority: rule.priority,
    multiplier: payload.multiplier,
    requiresReview: payload.requiresReview,
  };
}

function parseRulePayload(raw: string): StoredRulePayload {
  try {
    const parsed = JSON.parse(raw) as StoredRulePayload;
    if (parsed && typeof parsed === 'object') return parsed;
    return {};
  } catch {
    return {};
  }
}

function toLookupEntry(entry: {
  key: string;
  label: string;
  minValue: number | null;
  maxValue: number | null;
  amount: number;
  metaData: unknown;
}): PricingLookupEntryConfig {
  return {
    key: entry.key,
    label: entry.label,
    minValue: entry.minValue,
    maxValue: entry.maxValue,
    amount: entry.amount,
    metaData:
      entry.metaData && typeof entry.metaData === 'object'
        ? (entry.metaData as Record<string, unknown>)
        : null,
  };
}
