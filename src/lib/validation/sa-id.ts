/**
 * South African ID number validation.
 * Format: SSAAMMSSSCCA (13 digits)
 *  - SS: YY of birth
 *  - AA: MM of birth
 *  - SSS: sequence / gender digits
 *  - C: citizenship (0 = SA citizen, 1 = permanent resident, 2 = refugee)
 *  - A: Luhn checksum digit
 *
 * OCR confidence and validation are kept SEPARATE: a low OCR score flags for
 * review but a structurally valid ID is still recorded as VALID.
 */

export interface SaIdValidation {
  valid: boolean;
  errors: string[];
  details: {
    lengthValid: boolean;
    dateValid: boolean;
    checksumValid: boolean;
    structureValid: boolean;
  };
  parsed: {
    dateOfBirth: string | null; // YYYY-MM-DD
    gender: 'MALE' | 'FEMALE' | null;
    citizenship: 'SA_CITIZEN' | 'PERMANENT_RESIDENT' | 'REFUGEE' | null;
  };
}

/**
 * South African ID checksum (Luhn variant).
 *
 * Digits 1-12 (indexes 0-11) are summed with every second digit (indexes 1, 3,
 * 5, 7, 9, 11) doubled and reduced by 9 when the result exceeds 9. The check
 * digit (index 12) must equal (10 - sum % 10) % 10.
 *
 * Verified against the canonical fixture 8001015009087.
 */
export function luhnChecksumValid(idNumber: string): boolean {
  if (!/^\d{13}$/.test(idNumber)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let digit = Number(idNumber[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const expectedCheckDigit = (10 - (sum % 10)) % 10;
  return expectedCheckDigit === Number(idNumber[12]);
}

export function validateSouthAfricanId(input: string): SaIdValidation {
  const errors: string[] = [];
  const id = (input ?? '').replace(/\D/g, '');
  const details = {
    lengthValid: false,
    dateValid: false,
    checksumValid: false,
    structureValid: false,
  };
  const parsed = {
    dateOfBirth: null as string | null,
    gender: null as SaIdValidation['parsed']['gender'],
    citizenship: null as SaIdValidation['parsed']['citizenship'],
  };

  if (id.length !== 13) {
    errors.push('ID number must be exactly 13 digits');
    return { valid: false, errors, details, parsed };
  }
  details.lengthValid = true;

  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  const seq = id.slice(6, 10);
  const citizenshipDigit = id[10];

  // Century: choose the candidate century that is not in the future.
  const now = new Date();
  const twoDigitDate = (year: number) => new Date(Date.UTC(year, mm - 1, dd));
  const currentCentury = 2000;
  const checkDate = twoDigitDate(currentCentury + yy);
  const century =
    checkDate.getTime() <= now.getTime() ? currentCentury : currentCentury - 100;
  const date = twoDigitDate(century + yy);
  const dateOk =
    mm >= 1 &&
    mm <= 12 &&
    dd >= 1 &&
    dd <= 31 &&
    date.getUTCMonth() === mm - 1 &&
    date.getUTCDate() === dd;
  if (!dateOk) {
    errors.push('ID number contains an invalid date of birth');
  } else {
    details.dateValid = true;
    parsed.dateOfBirth = `${century + yy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    parsed.gender = Number(seq[3]) < 5 ? 'FEMALE' : 'MALE';
    parsed.citizenship =
      citizenshipDigit === '0'
        ? 'SA_CITIZEN'
        : citizenshipDigit === '1'
          ? 'PERMANENT_RESIDENT'
          : 'REFUGEE';
  }

  if (luhnChecksumValid(id)) {
    details.checksumValid = true;
  } else {
    errors.push('ID number checksum is invalid');
  }

  // Basic structure: 13 digits, not a single repeated digit, citizenship digit
  // limited to the documented values (0/1/2), sequence digits 0000-4999/5000+.
  if (/^(\d)\1{12}$/.test(id)) {
    errors.push('ID number structure is invalid (repeated digit)');
  } else if (!['0', '1', '2'].includes(citizenshipDigit!)) {
    errors.push('ID number citizenship digit is not recognised');
  } else {
    details.structureValid = true;
  }

  return { valid: errors.length === 0, errors, details, parsed };
}

/** Normalize an OCR'd ID string: strip spaces, dashes and non-digits. */
export function normalizeIdCandidate(raw: string): string {
  return (raw ?? '').replace(/[\s-]/g, '').replace(/\D/g, '');
}
