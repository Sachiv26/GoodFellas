/**
 * Text normalisation helpers shared across OCR results.
 */
export function normalizeWhitespace(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}

export function normalizeWhitespaceLines(str: string): string[] {
  return str
    .split(/\r?\n/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

export function digitsOnly(str: string): string {
  return (str ?? '').replace(/\D/g, '');
}

export function normalizePostalCode(value: string): string | null {
  const digits = digitsOnly(value);
  if (digits.length !== 4) return null;
  return digits;
}

export function normalizeDate(value: string): string | null {
  const normalized = normalizeWhitespace(value);
  // dd/mm/yyyy or dd-mm-yyyy
  const dmy = normalized.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/);
  if (dmy) {
    const [_, dd, mm, yyyy] = dmy;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  // yyyy-mm-dd
  const iso = normalized.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/);
  if (iso) {
    const [_, yyyy, mm, dd] = iso;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }
  return null;
}

export function normalizeNameCase(value: string): string {
  return normalizeWhitespace(value)
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
