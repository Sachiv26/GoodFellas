/**
 * Pricing repository — loads the pricing configuration from the database and
 * maps it into the pure engine types. Nothing about fees lives in code: the
 * repository only reshapes rows.
 *
 * The loaded configuration is cached in-process for a short window. Pricing
 * configuration changes only when an admin edits it, but it was being re-read
 * from the database on EVERY reprice — and against a pooled remote database
 * (~280ms per round-trip) those two queries cost over 2s of an upload that the
 * user waits on. The TTL keeps the cost off the hot path while still picking
 * up admin edits promptly.
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

/**
 * How long a loaded pricing configuration is reused before it is re-read.
 *
 * Deliberately short: an admin editing a fee should see it applied within
 * seconds, and the cache only exists to keep repeated reprices (which happen on
 * every upload) off the database.
 */
const PRICING_CACHE_TTL_MS = 30_000;

/**
 * Cache keyed by product id. Entries hold the parsed configuration plus the
 * day it was effective for, because rule effectiveness is date-dependent: a
 * config loaded for "today" must not be reused for a different date without
 * re-filtering.
 */
const pricingCache = new Map<
  string,
  { config: PricingConfig; effectiveDay: string; expiresAt: number }
>();

/** Drop the cached configuration for a product (call after an admin edit). */
export function invalidatePricingCache(productId?: string): void {
  if (productId) pricingCache.delete(productId);
  else pricingCache.clear();
}

export async function loadPricingConfig(options: LoadPricingOptions): Promise<PricingConfig> {
  const effectiveAt = options.effectiveAt ?? new Date();
  const effectiveDay = effectiveAt.toISOString().slice(0, 10);
  const cached = pricingCache.get(options.productId);
  if (cached && cached.expiresAt > Date.now() && cached.effectiveDay === effectiveDay) {
    return cached.config;
  }

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

  const config: PricingConfig = {
    version,
    currency: 'ZAR',
    effectiveFrom: effectiveDay,
    lookups: lookupConfigs,
    components: componentConfigs,
  };

  pricingCache.set(options.productId, {
    config,
    effectiveDay,
    expiresAt: Date.now() + PRICING_CACHE_TTL_MS,
  });

  return config;
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
