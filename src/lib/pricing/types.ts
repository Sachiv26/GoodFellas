/**
 * Pricing engine types.
 *
 * All fees are configuration (database) driven. Nothing about a fee is
 * hard-coded in components: the engine resolves components, rules and lookup
 * tables at calculation time and records the exact version used so historical
 * calculations remain reproducible.
 */
import type { PricingComponentKind } from '@prisma/client';

/** Named inputs available to rules and lookup resolution. */
export interface PricingInputs {
  /** Application context. */
  applicationDate: string; // ISO date (yyyy-mm-dd)
  currentExpiryDate: string | null;
  ownerType: 'INDIVIDUAL' | 'ORGANISATION';
  province: string | null;
  municipality: string | null;
  /** Vehicle (from licence disc / manual correction). */
  vehicleType: string | null;
  /**
   * Which TARE licence-fee column applies (see `VEHICLE_CLASSES`). Selected by
   * the customer on the first page of the application and used as the scope of
   * the licence-fee lookup.
   */
  vehicleClass: string | null;
  tareWeight: number | null;
  gvm: number | null;
  /** Delivery / service selections. */
  deliveryRequested: boolean;
  /** Extra top-level flags that rules may reference. */
  [key: string]: unknown;
}

/** A rule expression node — pure data, evaluated without eval(). */
export type PricingExpr =
  | { op: 'always' }
  | { op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'; path: string; value: string | number | boolean | null }
  | { op: 'in' | 'notIn'; path: string; value: Array<string | number> }
  | { op: 'exists' | 'missing'; path: string }
  | { op: 'and' | 'or'; args: PricingExpr[] }
  | { op: 'not'; arg: PricingExpr }
  | { op: 'daysBetween'; path: string; compareTo: string; value: number; comparator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' };

/** How a component computes its amount. */
export type PricingAmountSpec =
  | { type: 'fixed'; amount: number }
  | { type: 'percentageOf'; path: string; rate: number; min?: number; max?: number }
  | { type: 'percentageOfOverdueMonths'; rate: number; minMonths?: number }
  | { type: 'lookup'; table: string; keyPath: string; rangePath?: string }
  | { type: 'lookupRange'; table: string; rangePath: string; scopePath?: string }
  | { type: 'lookupSum'; table: string; keys: string[] };

export interface PricingRuleConfig {
  /** Unique code inside the component, e.g. LATE_LICENSING. */
  code: string;
  name: string;
  /** When this evaluates false the component contributes 0. */
  when: PricingExpr;
  amount: PricingAmountSpec;
  /** Higher priority evaluates first (rules are additive unless disabled). */
  priority: number;
  /** Optional per-rule rate multiplier applied to the amount (configurable). */
  multiplier?: number;
  /** Skip the component entirely when `when` is false (default true). */
  skipWhenFalse?: boolean;
  /** Marks amounts that must be reviewed by an admin before use. */
  requiresReview?: boolean;
}

export interface PricingComponentConfig {
  code: string;
  name: string;
  kind: PricingComponentKind;
  label: string;
  /** Applied to the total: 1 = additive, -1 = discount. */
  sign?: 1 | -1;
  rules: PricingRuleConfig[];
}

export interface PricingLookupTableConfig {
  code: string;
  name: string;
  description?: string;
  entries: PricingLookupEntryConfig[];
}

export interface PricingLookupEntryConfig {
  key: string;
  label: string;
  minValue?: number | null;
  maxValue?: number | null;
  amount: number;
  metaData?: Record<string, unknown> | null;
}

/** Full pricing configuration snapshot (product.config.pricing). */
export interface PricingConfig {
  /** Version of the configuration; recorded on every calculation. */
  version: number;
  currency: string;
  /** Bumped date from which this config is effective (ISO). */
  effectiveFrom?: string;
  lookups: PricingLookupTableConfig[];
  components: PricingComponentConfig[];
  /** Extra constraints surfaced to the admin UI. */
  notes?: string;
}

export interface PricingComponentResult {
  componentCode: string;
  label: string;
  kind: PricingComponentKind;
  ruleCode: string;
  ruleName: string;
  amount: number;
  applied: boolean;
  requiresReview: boolean;
  reason: string;
  lookup?: { table: string; key?: string | null; range?: string | null };
}

export interface PricingCalculationResult {
  version: number;
  currency: string;
  inputs: PricingInputs;
  components: PricingComponentResult[];
  subtotal: number;
  total: number;
  warnings: string[];
}
