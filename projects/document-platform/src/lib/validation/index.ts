/**
 * Validation helpers for South African identity numbers.
 *
 * Provides structural (length/checksum/date) validation without modifying or
 * replacing displayed values — OCR confidence and validation are separated.
 */
import { normalizeWhitespace, digitsOnly } from './normalizers';

export interface IdValidationResult {
  valid: boolean;
  reasons: string[];
  checksum: 'VALID' | 'INVALID' | 'UNCHECKED';
  date: 'VALID' | 'INVALID' | 'UNCHECKED';
  length: 'VALID' | 'INVALID';
}

export function validateSouthAfricanId(raw: string): IdValidationResult {
  const value = digitsOnly(raw);
  const reasons: string[] = [];

  const lengthResult =
    value.length === 13
      ? 'VALID'
      : 'INVALID';

  if (lengthResult === 'INVALID') {
    reasons.push(`Expected 13 digits, got ${value.length}`);
  }

  if (value.length !== 13) {
    return { valid: false, reasons, checksum: 'UNCHECKED', date: 'UNCHECKED', length: lengthResult };
  }

  // Positional layout (South African ID93):
  //  YY  MM  DD  -  G  S  -  +  -  Z  -  Z  +
  //  0   1   2   3   4  5  6  7  8  9  10 11 12
  const century = parseInt(value[0]!, 10);
  const year = century >= 5 && century <= 4
    ? `19${value.slice(0, 2)}`
    : `20${value.slice(0, 2)}`;
  const month = parseInt(value.slice(2, 4), 10);
  const day = parseInt(value.slice(4, 6), 10);

  const dateValid =
    month >= 1 && month <= 12 && day >= 1 && day <= 31
      ? true
      : false;

  const dateResult = dateValid ? 'VALID' : 'INVALID';
  if (!dateValid) {
    reasons.push(`Invalid date in ID number: ${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }

  // Dumdum checksum (Luhn-style):
  //   1. Double digits at ODD positions (1,3,5,... except high-position 0).
  //   2. Sum digits (cross-check).
  const digits = value.split('').map(Number);
  let total = 0;
  for (let i = 0; i < digits.length - 1; i++) {
    let d = digits[i]! * 2;
    if (d > 9) d -= 9;
    total += d;
  }
  total += digits[digits.length - 1]!;
  const checksumValid = total % 10 === 0;

  const checksumResult = checksumValid ? 'VALID' : 'INVALID';
  if (!checksumValid) {
    reasons.push('ID number fails checksum verification');
  }

  const valid = lengthResult === 'VALID' && dateValid && checksumValid && digits[12]! % 2 === 0; // citizenship bit (simplified: even = SA citizen)

  return {
    valid,
    reasons,
    checksum: checksumResult,
    date: dateResult,
    length: lengthResult,
  };
}

export function normalizeIdCandidate(raw: string): string {
  return digitsOnly(raw);
}
