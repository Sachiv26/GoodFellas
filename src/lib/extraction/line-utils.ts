/**
 * Shared OCR line grouping and labelled-value helpers.
 */

export interface OcrWordLike {
  text: string;
  confidence: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export interface OcrLine {
  text: string;
  confidence: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export function groupWordsIntoLines(words: OcrWordLike[]): OcrLine[] {
  const sorted = [...words].sort((a, b) => (a.bbox?.y0 ?? 0) - (b.bbox?.y0 ?? 0));
  const lines: OcrLine[] = [];
  let current: OcrLine = { text: '', confidence: 0, bbox: undefined };
  let count = 0;
  let lastY: number | null = null;
  for (const w of sorted) {
    const y = w.bbox?.y0 ?? 0;
    if (lastY !== null && Math.abs(y - lastY) > 14) {
      if (current.text.trim() && count > 0) {
        lines.push({ ...current, confidence: current.confidence / count });
      }
      current = { text: '', confidence: 0, bbox: undefined };
      count = 0;
    }
    current.text += (current.text ? ' ' : '') + w.text;
    current.confidence += w.confidence;
    count++;
    lastY = y;
  }
  if (current.text.trim() && count > 0) {
    lines.push({ ...current, confidence: current.confidence / count });
  }
  return lines;
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Find "label: value" / "label value" patterns in OCR lines. */
export function extractLabelledValue(
  lines: OcrLine[],
  labels: string[],
  options?: { minConfidence?: number }
): { value: string; confidence: number } | null {
  for (const label of labels) {
    const regex = new RegExp(`${escapeRegex(label)}\\s*[:\\-]?\\s*(.{2,90})`, 'i');
    for (const line of lines) {
      const m = line.text.match(regex);
      if (m && m[1]) {
        const value = m[1].trim();
        if (value && !/^(id|no|number|s\.?a\.?)$/i.test(value)) {
          return { value, confidence: line.confidence || 0.5 };
        }
      }
    }
  }
  return null;
}

/** Find the LAST "label value" occurrence (documents often repeat headers). */
export function extractLastLabelledValue(
  lines: OcrLine[],
  labels: string[]
): { value: string; confidence: number } | null {
  let found: { value: string; confidence: number } | null = null;
  for (const label of labels) {
    const regex = new RegExp(`${escapeRegex(label)}\\s*[:\\-]?\\s*(.{2,90})`, 'i');
    for (const line of lines) {
      const matches = line.text.match(new RegExp(regex, 'gi'));
      if (matches) {
        const m = line.text.match(regex);
        if (m && m[1]) {
          found = { value: m[1].trim(), confidence: line.confidence || 0.5 };
        }
      }
    }
  }
  return found;
}
