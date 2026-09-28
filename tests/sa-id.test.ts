import { describe, expect, it } from '@jest/globals';
import {
  luhnChecksumValid,
  normalizeIdCandidate,
  validateSouthAfricanId,
} from '@/lib/validation/sa-id';

/**
 * SA ID validation must keep three concerns separate:
 *   1. structure/checksum  → validity
 *   2. parsed facts        → dob / gender / citizenship
 * Validation NEVER depends on OCR confidence (that is a separate signal).
 */
describe('South African ID validation', () => {
  it('accepts the canonical fixture 8001015009087', () => {
    const result = validateSouthAfricanId('8001015009087');
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.details).toEqual({
      lengthValid: true,
      dateValid: true,
      checksumValid: true,
      structureValid: true,
    });
  });

  it('parses date of birth, gender and citizenship from a valid ID', () => {
    const result = validateSouthAfricanId('8001015009087'); // 5009 -> digit 9 => MALE
    expect(result.parsed.dateOfBirth).toBe('1980-01-01');
    expect(result.parsed.gender).toBe('MALE');
    expect(result.parsed.citizenship).toBe('SA_CITIZEN');
  });

  it('rejects a wrong check digit', () => {
    const result = validateSouthAfricanId('8001015009088');
    expect(result.valid).toBe(false);
    expect(result.details.checksumValid).toBe(false);
    expect(result.errors).toContain('ID number checksum is invalid');
  });

  it('rejects anything that is not exactly 13 digits', () => {
    for (const value of ['800101500908', '80010150090871', '', 'not-an-id']) {
      const result = validateSouthAfricanId(value);
      expect(result.valid).toBe(false);
      expect(result.details.lengthValid).toBe(false);
      expect(result.parsed.dateOfBirth).toBeNull();
    }
  });

  it('rejects impossible dates while still reporting the checksum separately', () => {
    // 80 13 32 0908 0 8 = plausible shape but month 13 / day 32 are impossible.
    // The check digit is computed so the ONLY failure is the date.
    const withCheckDigit = (raw12: string) => {
      let sum = 0;
      for (let i = 0; i < 12; i++) {
        let digit = Number(raw12[i]);
        if (i % 2 === 1) {
          digit *= 2;
          if (digit > 9) digit -= 9;
        }
        sum += digit;
      }
      return `${raw12}${(10 - (sum % 10)) % 10}`;
    };
    const result = validateSouthAfricanId(withCheckDigit('801332090808'));
    expect(result.details.lengthValid).toBe(true);
    expect(result.details.dateValid).toBe(false);
    expect(result.details.checksumValid).toBe(true);
    expect(result.valid).toBe(false);
    expect(result.parsed.dateOfBirth).toBeNull();
  });

  it('rejects replicated digits and unknown citizenship digits', () => {
    expect(validateSouthAfricanId('1111111111111').errors).toContain(
      'ID number structure is invalid (repeated digit)'
    );
    // 8001015009 3 87 -> citizenship digit 3 is not documented.
    const citizenshipDigit = '8001015009387';
    const result = validateSouthAfricanId(citizenshipDigit);
    expect(result.details.structureValid).toBe(false);
    expect(result.errors).toContain('ID number citizenship digit is not recognised');
  });

  it('luhnChecksumValid only accepts exactly 13 digits', () => {
    expect(luhnChecksumValid('8001015009087')).toBe(true);
    expect(luhnChecksumValid('800101500908')).toBe(false);
    expect(luhnChecksumValid('80010150090AB')).toBe(false);
  });

  it('normalizeIdCandidate strips spaces/dashes and non-digits', () => {
    expect(normalizeIdCandidate(' 800101 5009-087 ')).toBe('8001015009087');
    expect(normalizeIdCandidate('I23456789O12')).toBe('2345678912');
  });
});
