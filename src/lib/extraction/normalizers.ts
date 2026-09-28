/**
 * Text normalization helpers for OCR output.
 * These clean noisy OCR strings; they never invent data.
 */
export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function normalizeNameCase(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      // Preserve common particles
      if (['van', 'de', 'du', 'da', 'von', 'der', 'den'].includes(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

export function normalizeUppercase(text: string): string {
  return normalizeWhitespace(text).toUpperCase();
}

export function digitsOnly(text: string): string {
  return (text ?? '').replace(/\D/g, '');
}

export function normalizePostalCode(text: string): string | null {
  const m = text.match(/\b(\d{4})\b/);
  return m ? m[1]! : null;
}

/** Parse common SA date formats to ISO yyyy-mm-dd. Returns null when unsure. */
export function normalizeDate(text: string): string | null {
  const cleaned = normalizeWhitespace(text);
  // dd/mm/yyyy or dd-mm-yyyy or yyyy-mm-dd
  const iso = cleaned.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const [, y, m, d] = iso;
    return `${y}-${m}-${d}`;
  }
  const dmy = cleaned.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y!.length === 2 ? (Number(y) > 50 ? `19${y}` : `20${y}`) : y;
    return `${year}-${m!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  const dmyNamed = cleaned.match(
    /\b(\d{1,2})\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{2,4})/i
  );
  if (dmyNamed) {
    const months: Record<string, string> = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    };
    const month = months[dmyNamed[2]!.slice(0, 3).toLowerCase()];
    if (month) {
      const year = dmyNamed[3]!.length === 2
        ? Number(dmyNamed[3]) > 50 ? `19${dmyNamed[3]}` : `20${dmyNamed[3]}`
        : dmyNamed[3];
      return `${year}-${month}-${dmyNamed[1]!.padStart(2, '0')}`;
    }
  }
  return null;
}

/** Compute initials from first names: "John Michael" -> "J M" */
export function computeInitials(firstNames: string): string | null {
  if (!firstNames) return null;
  const parts = normalizeWhitespace(firstNames).split(' ').filter(Boolean);
  if (parts.length === 0) return null;
  return parts.map((p) => `${p[0]!.toUpperCase()}.`).join(' ');
}

/** Compute similarity 0..1 between two names (order-insensitive token match). */
export function nameSimilarity(a: string, b: string): number {
  const clean = (s: string) =>
    normalizeWhitespace(s.toLowerCase()).replace(/[^a-z\s]/g, '').split(' ').filter(Boolean);
  const tokensA = clean(a);
  const tokensB = clean(b);
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  const setB = new Set(tokensB);
  const setA = new Set(tokensA);
  let matched = 0;
  for (const t of setA) {
    if (setB.has(t)) matched++;
  }
  return matched / Math.max(setA.size, setB.size);
}

/**
 * Fuzzy match a single-token name allowing typical OCR confusions
 * (0/O, 1/I/l, 5/S, 8/B, etc.). Returns true when the strings are equal
 * after normalizing confusable characters.
 */
export function ocrTokenFuzzyEqual(a: string, b: string): boolean {
  const confusable = (s: string) =>
    s.toLowerCase().replace(/[0]/g, 'o').replace(/[1|]/g, 'l').replace(/[5]/g, 's').replace(/[8]/g, 'b').replace(/[^a-z]/g, '');
  return confusable(a) === confusable(b);
}
