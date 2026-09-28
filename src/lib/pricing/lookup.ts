/**
 * Lookup table resolution (province / municipality / vehicle type / weight
 * bracket / penalty / arrears / fees).
 *
 * Missing values NEVER fall back to an invented amount: an unresolved lookup
 * yields amount 0 plus a warning so the admin sees it and configures it.
 */
import type { PricingLookupEntryConfig, PricingLookupTableConfig } from './types';
import { toNumber } from './expression';

export interface LookupResolution {
  amount: number;
  entryKey: string | null;
  entryLabel: string | null;
  range: string | null;
  resolved: boolean;
  warnings: string[];
}

export function findLookupTable(
  tables: PricingLookupTableConfig[],
  code: string
): PricingLookupTableConfig | null {
  return tables.find((t) => t.code === code) ?? null;
}

/**
 * Exact key match (case-insensitive), optionally scoped by a secondary key.
 *
 * When a scope is supplied, entries explicitly scoped to it win. Unscoped
 * entries remain a fallback so a table that is only partially scoped (e.g.
 * fee rows that have not been loaded for every class yet) still resolves.
 */
export function resolveByKey(
  tables: PricingLookupTableConfig[],
  tableCode: string,
  key: string | null,
  scopeKey?: string | null
): LookupResolution {
  const warnings: string[] = [];
  const table = findLookupTable(tables, tableCode);
  if (!table) {
    warnings.push(`Lookup table "${tableCode}" is not configured`);
    return emptyResolution(warnings);
  }
  if (!key) {
    warnings.push(`Lookup "${tableCode}" skipped — no input value available`);
    return emptyResolution(warnings);
  }

  const normalisedKey = key.trim().toLowerCase();
  const scope = scopeKey?.trim().toLowerCase() ?? null;

  // Scoped keys use "scope::key" so province/municipality can share a table.
  const matching = (entry: PricingLookupEntryConfig) => {
    const parts = splitScopedKey(entry.key);
    if (scope && parts.scope && parts.scope !== scope) return false;
    return parts.key.toLowerCase() === normalisedKey;
  };
  const scoped = preferScoped(table.entries.filter(matching), scope);
  const candidates = scoped.entries;

  if (scoped.scopeRequired) {
    warnings.push(
      `Lookup "${tableCode}" skipped — the table is scoped and no scope value was supplied`
    );
    return emptyResolution(warnings);
  }

  const entry = candidates[0];
  if (!entry) {
    warnings.push(
      `No entry in "${tableCode}" for ${scope ? `${scope}/` : ''}${key} — amount left at 0 and needs configuration`
    );
    return emptyResolution(warnings);
  }
  return {
    amount: entry.amount,
    entryKey: entry.key,
    entryLabel: entry.label,
    range: null,
    resolved: true,
    warnings,
  };
}

/** Resolve a numeric value against min/max brackets. Overlaps are an error. */
export function resolveByRange(
  tables: PricingLookupTableConfig[],
  tableCode: string,
  value: number | null,
  scopeKey?: string | null
): LookupResolution {
  const warnings: string[] = [];
  const table = findLookupTable(tables, tableCode);
  if (!table) {
    warnings.push(`Lookup table "${tableCode}" is not configured`);
    return emptyResolution(warnings);
  }
  if (value === null) {
    warnings.push(`Lookup "${tableCode}" skipped — no numeric input available`);
    return emptyResolution(warnings);
  }

  const scope = scopeKey?.trim().toLowerCase() ?? null;
  const scopedMatches = preferScoped(
    table.entries.filter((entry) => {
      const parts = splitScopedKey(entry.key);
      if (scope && parts.scope && parts.scope !== scope) return false;
      const min = entry.minValue ?? 0;
      const max = entry.maxValue ?? Number.POSITIVE_INFINITY;
      return value >= min && value <= max;
    }),
    scope
  );

  if (scopedMatches.scopeRequired) {
    warnings.push(
      `Lookup "${tableCode}" skipped — the table is scoped and no scope value was supplied`
    );
    return emptyResolution(warnings);
  }

  const matches = scopedMatches.entries;

  if (matches.length === 0) {
    warnings.push(
      `No bracket in "${tableCode}" covers ${value}${scope ? ` for ${scope}` : ''} — amount left at 0 and needs configuration`
    );
    return emptyResolution(warnings);
  }
  if (matches.length > 1) {
    warnings.push(
      `Brackets overlap in "${tableCode}" for ${value} — narrowest bracket used; correct the configuration`
    );
  }
  const best = matches
    .slice()
    .sort(
      (a, b) =>
        (a.maxValue ?? Number.POSITIVE_INFINITY) - (a.minValue ?? 0) -
        ((b.maxValue ?? Number.POSITIVE_INFINITY) - (b.minValue ?? 0))
    )[0]!;

  return {
    amount: best.amount,
    entryKey: best.key,
    entryLabel: best.label,
    range: rangeLabel(best),
    resolved: true,
    warnings,
  };
}

/** Sum several keys within one table (e.g. penalty + arrears + service fee). */
export function resolveSumByKeys(
  tables: PricingLookupTableConfig[],
  tableCode: string,
  keys: string[]
): LookupResolution {
  const table = findLookupTable(tables, tableCode);
  if (!table) {
    return emptyResolution([`Lookup table "${tableCode}" is not configured`]);
  }
  let amount = 0;
  const matched: string[] = [];
  const warnings: string[] = [];
  for (const key of keys) {
    const resolution = resolveByKey(tables, tableCode, key);
    if (resolution.resolved) {
      amount += resolution.amount;
      matched.push(resolution.entryLabel ?? key);
    } else {
      warnings.push(...resolution.warnings);
    }
  }
  if (matched.length === 0) {
    return { ...emptyResolution(warnings), amount: 0 };
  }
  return {
    amount,
    entryKey: keys.join(','),
    entryLabel: matched.join(' + '),
    range: null,
    resolved: matched.length === keys.length,
    warnings,
  };
}

function splitScopedKey(key: string): { scope: string | null; key: string } {
  const index = key.indexOf('::');
  if (index === -1) return { scope: null, key };
  return { scope: key.slice(0, index).toLowerCase(), key: key.slice(index + 2) };
}

/**
 * Prefer entries explicitly scoped to the requested scope over unscoped ones.
 *
 * This lets one table hold the same bracket for several scopes (e.g. the TARE
 * licence-fee table holding a row per vehicle class) without the unscoped
 * fallback masking a specifically configured value.
 *
 * When no scope is requested but the matches are scoped entries, resolution is
 * refused (`scopeRequired`) rather than silently picking one: a scoped table
 * exists precisely because the amount depends on the scope, so guessing one
 * would price the customer for the wrong vehicle.
 */
function preferScoped(
  entries: PricingLookupEntryConfig[],
  scope: string | null
): { entries: PricingLookupEntryConfig[]; scopeRequired: boolean } {
  if (!scope) {
    const anyScoped = entries.some((entry) => splitScopedKey(entry.key).scope !== null);
    return { entries: anyScoped ? [] : entries, scopeRequired: anyScoped };
  }
  const scoped = entries.filter((entry) => splitScopedKey(entry.key).scope === scope);
  return { entries: scoped.length > 0 ? scoped : entries, scopeRequired: false };
}

function rangeLabel(entry: PricingLookupEntryConfig): string {
  const min = entry.minValue ?? 0;
  const max = entry.maxValue ?? null;
  return max === null ? `${min}+` : `${min}-${max}`;
}

function emptyResolution(warnings: string[]): LookupResolution {
  return {
    amount: 0,
    entryKey: null,
    entryLabel: null,
    range: null,
    resolved: false,
    warnings,
  };
}

export { toNumber };
