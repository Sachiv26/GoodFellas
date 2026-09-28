/**
 * Pricing configuration types.
 *
 * Everything is database-driven and editable through admin UI:
 *   - PricingComponent: fixed fee, percentage, conditional fee, etc.
 *   - PricingLookupTable: province, municipality, vehicle type, weight, penalty, arrears, service fee, delivery fee, transaction fee
 *   - PricingRule: condition + amount expression
 *   - PricingCalculation: complete reconstructed calculation
 *
 * No fees are hard-coded in React.
 */
export type PricingComponentKind =
  | 'fixed'
  | 'percentage'
  | 'conditional'
  | 'lookup'
  | 'range'
  | 'lookup_sum'
  | 'service_fee'
  | 'delivery_fee'
  | 'transaction_fee'
  | 'licence_fee'
  | 'penalty'
  | 'arrears'
  | 'other';

export type PricingAmountType =
  | 'fixed'
  | 'percentageOf'
  | 'lookup'
  | 'lookupRange'
  | 'lookupSum';

export interface PricingAmountSpec {
  type: PricingAmountType;
  /** Fixed amount in currency units. */
  amount?: number;
  /** Percentage rate (e.g. 2.5 means 2.5%). */
  rate?: number;
  /** Base path for percentage calculation (dot-separated). */
  path?: string;
  /** Minimum result after percentage. */
  min?: number;
  /** Maximum result after percentage. */
  max?: number;
  /** Lookup table code for lookup/lookupRange/lookupSum. */
  table?: string;
  /** Key path to resolve for lookup type. */
  keyPath?: string;
  /** Range path (numeric value to bracket-match) for lookupRange. */
  rangePath?: string;
  /** Keys to sum within the lookup table for lookupSum. */
  keys?: string[];
}

export interface PricingRule {
  id: string;
  version: number;
  code?: string;
  name?: string;
  active: boolean;
  effectiveFrom: Date;
  effectiveTo?: Date;
  /** Condition expression: which inputs must be present / which comparisons must hold. */
  when: PricingCondition;
  /** Amount to apply when the condition is met. */
  amount: PricingAmountSpec;
  /** Multiplier (e.g. for province-based surcharges applied on top of base). */
  multiplier?: number;
  /** Display label shown in calculation breakdown. */
  label?: string;
  /** Priority: higher = evaluated first; used for tie-breaking in overlapping rules. */
  priority?: number;
  /** Set true if this rule requires manual review before it can be applied. */
  requiresReview?: boolean;
}

export interface PricingLookupTable {
  id: string;
  code: string;
  name: string;
  description?: string;
  active: boolean;
  entries: PricingLookupEntry[];
}

export interface PricingLookupEntry {
  id: string;
  key: string;
  label: string;
  minValue?: number;
  maxValue?: number;
  amount: number;
  active: boolean;
  metaData?: Record<string, unknown>;
}

export interface PricingConfig {
  version: number;
  currency: string;
  components: PricingComponent[];
  lookups: PricingLookupTable[];
  effectiveFrom: Date;
  effectiveTo?: Date;
}

export interface PricingComponent {
  id: string;
  code: string;
  name: string;
  kind: PricingComponentKind;
  label: string;
  active: boolean;
  version: number;
  /** Sign: +1 for normal fees, -1 for discounts/credits (if needed). */
  sign?: number;
  rules: PricingRule[];
}

export interface PricingCalculation {
  id: string;
  applicationId: string;
  pricingVersion: number;
  pricingEffectiveFrom: Date;
  inputsJson: Record<string, unknown>;
  componentsJson: Array<{
    componentCode: string;
    label: string;
    kind: string;
    ruleCode?: string;
    ruleName?: string;
    amount: number;
    applied: boolean;
    reason: string;
    lookup?: {
      table: string;
      key?: string;
      range?: string;
    };
  }>;
  subtotal: number;
  total: number;
  currency: string;
  warnings: string[];
  calculatedAt: Date;
}

export type PricingCondition =
  | PricingConditionAlways
  | PricingConditionAnd
  | PricingConditionOr
  | PricingConditionNot
  | PricingConditionExists
  | PricingConditionMissing
  | PricingConditionEq
  | PricingConditionNeq
  | PricingConditionGt
  | PricingConditionGte
  | PricingConditionLt
  | PricingConditionLte
  | PricingConditionIn
  | PricingConditionNotIn
  | PricingConditionDaysBetween;

export interface PricingConditionAlways {
  op: 'always';
}

export interface PricingConditionAnd {
  op: 'and';
  args: PricingCondition[];
}

export interface PricingConditionOr {
  op: 'or';
  args: PricingCondition[];
}

export interface PricingConditionNot {
  op: 'not';
  arg: PricingCondition;
}

export interface PricingConditionExists {
  op: 'exists';
  path: string;
}

export interface PricingConditionMissing {
  op: 'missing';
  path: string;
}

export interface PricingConditionEq {
  op: 'eq';
  path: string;
  value: string | number | boolean;
}

export interface PricingConditionNeq {
  op: 'neq';
  path: string;
  value: string | number | boolean;
}

export interface PricingConditionGt {
  op: 'gt';
  path: string;
  value: number;
}

export interface PricingConditionGte {
  op: 'gte';
  path: string;
  value: number;
}

export interface PricingConditionLt {
  op: 'lt';
  path: string;
  value: number;
}

export interface PricingConditionLte {
  op: 'lte';
  path: string;
  value: number;
}

export interface PricingConditionIn {
  op: 'in';
  path: string;
  value: Array<string | number>;
}

export interface PricingConditionNotIn {
  op: 'notIn';
  path: string;
  value: Array<string | number>;
}

export interface PricingConditionDaysBetween {
  op: 'daysBetween';
  path: string;
  compareTo: string;
  comparator: 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
  value: number;
}
