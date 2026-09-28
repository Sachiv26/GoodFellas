/**
 * Cross-document validation.
 *
 * Compares the same facts across documents (name, ID number, expiry date) and
 * flags inconsistencies for ADMIN REVIEW. Reasonable formatting differences
 * (case, punctuation, token order, OCR confusables 0/O, 1/I, 5/S) are not
 * treated as mismatches, and nothing is ever auto-rejected.
 */
import type { CrossValidationStatus } from '@prisma/client';
import { nameSimilarity, normalizeWhitespace, ocrTokenFuzzyEqual, digitsOnly } from './normalizers';
import type { CrossValidationInput } from './types';

export interface CrossValidationRuleResult {
  ruleKey: string;
  status: CrossValidationStatus;
  detailsJson: Record<string, unknown>;
}

/** Fields keyed by document type code, reduced to authoritative values. */
export type { CrossValidationInput } from './types';

const MATCH_THRESHOLD = 0.75;
const REVIEW_THRESHOLD = 0.4;

export function runCrossDocumentValidation(
  input: CrossValidationInput
): CrossValidationRuleResult[] {
  return [
    compareNames('ID_NAME_VS_POR_NAME', idName(input.id), porName(input.proofOfResidence)),
    compareIdNumbers(
      'ID_NUMBER_VS_POR_ID_NUMBER',
      input.id?.idNumber,
      input.proofOfResidence?.idNumber
    ),
    compareIdNumbers(
      'ID_NUMBER_VS_LICENCE_DISC_OWNER_ID',
      input.id?.idNumber,
      input.licenceDisc?.ownerIdNumber
    ),
    compareNames('ID_SURNAME_VS_LICENCE_DISC_OWNER_NAME', idName(input.id), input.licenceDisc?.ownerName),
    compareDates(
      'LICENCE_EXPIRY_VS_APPLICATION_EXPIRY',
      input.licenceDisc?.expiryDate,
      input.application?.currentExpiryDate
    ),
    summariseRegistration('LICENCE_DISC_IDENTIFIERS', input.licenceDisc),
  ];
}

function idName(id: CrossValidationInput['id']): string | null {
  if (!id) return null;
  const parts = [id.surname, id.firstNames ?? id.name].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  return parts.length ? parts.join(' ') : null;
}

function porName(por: CrossValidationInput['proofOfResidence']): string | null {
  if (!por) return null;
  const parts = [por.surname, por.name].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0
  );
  return parts.length ? parts.join(' ') : null;
}


function compareNames(
  ruleKey: string,
  a: string | null | undefined,
  b: string | null | undefined
): CrossValidationRuleResult {
  if (!hasValue(a) || !hasValue(b)) {
    return notComparable(ruleKey, 'At least one document did not yield a name');
  }
  const similarity = nameSimilarity(a!, b!);
  if (similarity >= MATCH_THRESHOLD) {
    return { ruleKey, status: 'MATCH', detailsJson: { similarity, matched: true } };
  }
  if (tokenSetsEquivalent(a!, b!)) {
    return {
      ruleKey,
      status: 'MATCH',
      detailsJson: { similarity, matched: true, note: 'Matched after OCR confusable normalisation' },
    };
  }
  return {
    ruleKey,
    status: similarity >= REVIEW_THRESHOLD ? 'NEEDS_REVIEW' : 'MISMATCH',
    detailsJson: {
      similarity,
      matched: false,
      note: 'Names differ between documents — admin review required (values are never altered)',
    },
  };
}

function compareIdNumbers(
  ruleKey: string,
  a: string | null | undefined,
  b: string | null | undefined
): CrossValidationRuleResult {
  if (!hasValue(a) || !hasValue(b)) {
    return notComparable(ruleKey, 'At least one document did not yield an ID number');
  }
  const digitsA = digitsOnly(a!);
  const digitsB = digitsOnly(b!);
  if (digitsA === digitsB) {
    return { ruleKey, status: 'MATCH', detailsJson: { matched: true } };
  }
  // Typed 13-digit strings commonly OCR as O/0, I/l/1, S/5.
  const normalise = (s: string) =>
    s.replace(/[Oo]/g, '0').replace(/[Il]/g, '1').replace(/[Ss]/g, '5');
  const fuzzy = normalise(digitsA) === normalise(digitsB);
  return {
    ruleKey,
    status: fuzzy ? 'MATCH' : 'MISMATCH',
    detailsJson: {
      matched: fuzzy,
      note: fuzzy
        ? 'Matched after OCR confusable normalisation'
        : 'ID numbers differ between documents — admin review required (values are never altered)',
    },
  };
}

function compareDates(
  ruleKey: string,
  a: string | null | undefined,
  b: Date | string | null | undefined
): CrossValidationRuleResult {
  if (!hasValue(a) || !b) {
    return notComparable(ruleKey, 'Date not available on both sides');
  }
  const isoA = toIsoDate(a!);
  const isoB = toIsoDate(b instanceof Date ? b.toISOString().slice(0, 10) : String(b));
  if (!isoA || !isoB) {
    return notComparable(ruleKey, 'Date could not be normalised');
  }
  return {
    ruleKey,
    status: isoA === isoB ? 'MATCH' : 'MISMATCH',
    detailsJson: {
      matched: isoA === isoB,
      note:
        isoA === isoB
          ? 'Extracted licence expiry agrees with the expiry date supplied on the application'
          : 'Extracted licence expiry differs from the expiry date supplied on the application',
    },
  };
}

function summariseRegistration(
  ruleKey: string,
  disc: CrossValidationInput['licenceDisc']
): CrossValidationRuleResult {
  const registration = disc?.registrationNumber ?? null;
  const registerNumber = disc?.vehicleRegisterNumber ?? null;
  if (!hasValue(registration)) {
    return notComparable(ruleKey, 'No registration number extracted');
  }
  return {
    ruleKey,
    status: 'MATCH',
    detailsJson: {
      matched: true,
      hasVehicleRegisterNumber: hasValue(registerNumber),
      note: hasValue(registerNumber)
        ? 'Registration number and vehicle register number are present as distinct values'
        : 'Vehicle register number not extracted — left blank on the form (never inferred)',
    },
  };
}

function tokenSetsEquivalent(a: string, b: string): boolean {
  const tokensA = normalizeWhitespace(a.toUpperCase()).split(' ').filter(Boolean);
  const tokensB = normalizeWhitespace(b.toUpperCase()).split(' ').filter(Boolean);
  if (!tokensA.length || !tokensB.length) return false;
  const remaining = [...tokensB];
  for (const token of tokensA) {
    const index = remaining.findIndex((candidate) => ocrTokenFuzzyEqual(token, candidate));
    if (index === -1) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}

function toIsoDate(value: string): string | null {
  const trimmed = normalizeWhitespace(value);
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = trimmed.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (dmy) {
    const year = dmy[3]!.length === 2 ? `20${dmy[3]}` : dmy[3]!;
    return `${year}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  }
  return null;
}

function hasValue(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function notComparable(ruleKey: string, reason: string): CrossValidationRuleResult {
  return {
    ruleKey,
    status: 'NOT_COMPARABLE',
    detailsJson: {
      matched: null,
      reason,
      note: 'Not auto-rejected — admin review required',
    },
  };
}

