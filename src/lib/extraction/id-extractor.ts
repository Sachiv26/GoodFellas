/**
 * South African ID document extraction from OCR output.
 * Locates the 13-digit ID number, validates it (checksum/date/structure),
 * then extracts labelled fields. Unknown fields stay null (no fabrication).
 */
import { validateSouthAfricanId, normalizeIdCandidate } from '@/lib/validation/sa-id';
import type { ExtractedField } from './types';
import { groupWordsIntoLines, extractLabelledValue, type OcrLine } from './line-utils';
import { normalizeNameCase, normalizeWhitespace, digitsOnly, normalizeDate } from './normalizers';
import type { ExtractionSource } from '@prisma/client';

export interface IdExtractionInput {
  rawText: string;
  words: Array<{ text: string; confidence: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }>;
  source?: ExtractionSource;
}

export function extractIdFields(input: IdExtractionInput): ExtractedField[] {
  const { rawText, words, source = 'OCR' } = input;
  const fields: ExtractedField[] = [];
  const push = (
    fieldName: string,
    value: string | null,
    confidence: number | null,
    status: ExtractedField['validationStatus'],
    notes?: string[],
    bbox?: ExtractedField['boundingBox']
  ) => {
    fields.push({
      fieldName,
      value,
      normalizedValue: value ? value.trim() : null,
      confidence,
      source,
      boundingBox: bbox ?? null,
      validationStatus: status,
      validationNotes: notes,
    });
  };

  const fullText = normalizeWhitespace(rawText);
  const lines: OcrLine[] = words.length
    ? groupWordsIntoLines(words)
    : fullText.split('\n').filter(Boolean).map((t) => ({ text: t, confidence: 0.4 }));

  const located = locateIdNumber(fullText, words);
  if (located.idNumber && located.validation) {
    const notes = located.validation.valid ? undefined : located.validation.errors;
    const status: ExtractedField['validationStatus'] = located.validation.valid ? 'VALID' : 'NEEDS_REVIEW';
    push('idNumber', located.idNumber, located.confidence, status, notes, located.bbox);
    push('dateOfBirth', located.validation.parsed.dateOfBirth, located.confidence, status, notes);
    push('gender', located.validation.parsed.gender, located.confidence, status, notes);
    push('citizenship', located.validation.parsed.citizenship, located.confidence, status, notes);
    push('documentType', 'RSA_ID', 1, 'VALID');
  } else {
    for (const f of ['idNumber', 'dateOfBirth', 'gender', 'citizenship']) {
      push(f, null, null, 'NEEDS_REVIEW', [f === 'idNumber' ? 'Could not locate a valid 13-digit ID number' : 'Depends on ID number']);
    }
    push('documentType', 'RSA_ID', 1, 'VALID');
  }
  extractNameFields(lines, push);
  return fields;
}

/** Scan OCR text for the best-supported 13-digit SA ID candidate. */
function locateIdNumber(
  fullText: string,
  words: IdExtractionInput['words']
): {
  idNumber: string | null;
  confidence: number | null;
  bbox: ExtractedField['boundingBox'];
  validation: ReturnType<typeof validateSouthAfricanId> | null;
} {
  const candidates: Array<{ digits: string; conf: number | null; bbox: ExtractedField['boundingBox'] }> = [];
  for (const group of fullText.match(/\d[\d\s.-]{10,}\d/g) ?? []) {
    const digits = digitsOnly(group);
    if (digits.length === 13) candidates.push({ digits, conf: null, bbox: null });
  }
  for (let i = 0; i < words.length; i++) {
    let acc = '';
    let confSum = 0;
    let count = 0;
    const start = words[i]!;
    for (let j = i; j < Math.min(words.length, i + 20); j++) {
      const w = words[j]!;
      acc += digitsOnly(w.text);
      confSum += w.confidence;
      count++;
      if (acc.length === 13) {
        candidates.push({ digits: acc, conf: confSum / count, bbox: start.bbox });
        break;
      }
      if (acc.length > 13) break;
    }
  }
  if (candidates.length === 0) {
    const joined = digitsOnly(fullText);
    for (let i = 0; i + 13 <= joined.length; i++) {
      candidates.push({ digits: joined.slice(i, i + 13), conf: null, bbox: null });
    }
  }

  let fallback: (typeof candidates)[number] | null = null;
  let fallbackValidation: ReturnType<typeof validateSouthAfricanId> | null = null;
  for (const cand of candidates) {
    const normalized = normalizeIdCandidate(cand.digits);
    const v = validateSouthAfricanId(normalized);
    if (v.valid) {
      return { idNumber: normalized, confidence: cand.conf ?? 0.6, bbox: cand.bbox ?? null, validation: v };
    }
    if (!fallback && v.details.lengthValid && v.details.dateValid) {
      fallback = cand;
      fallbackValidation = v;
    }
  }
  if (fallback) {
    return {
      idNumber: fallback.digits,
      confidence: fallback.conf ?? 0.5,
      bbox: fallback.bbox ?? null,
      validation: fallbackValidation,
    };
  }
  return { idNumber: null, confidence: null, bbox: null, validation: null };
}

function extractNameFields(lines: OcrLine[], push: (f: string, v: string | null, c: number | null, s: ExtractedField['validationStatus'], n?: string[]) => void): void {
  const surnameMatch = extractLabelledValue(lines, ['surname', 'van']);
  if (surnameMatch) {
    push('surname', normalizeNameCase(surnameMatch.value), Math.min(0.9, 0.6 * surnameMatch.confidence + 0.3), 'UNKNOWN');
  } else {
    push('surname', null, null, 'NEEDS_REVIEW', ['Surname label not found in OCR']);
  }

  const firstNamesMatch = extractLabelledValue(lines, ['first names', 'forenames', 'given names', 'name(s)', 'voornam']);
  if (firstNamesMatch) {
    push('firstNames', normalizeNameCase(firstNamesMatch.value), Math.min(0.9, 0.6 * firstNamesMatch.confidence + 0.3), 'UNKNOWN');
  } else {
    push('firstNames', null, null, 'NEEDS_REVIEW', ['First names label not found in OCR']);
  }

  if (firstNamesMatch?.value) {
    const parts = firstNamesMatch.value.trim().split(/\s+/).filter(Boolean);
    const initials = parts.length ? parts.map((p) => `${p[0]?.toUpperCase() ?? ''}.`).join(' ') : null;
    if (initials) {
      push('initials', initials, firstNamesMatch.confidence, 'VALID');
    } else {
      push('initials', null, null, 'NEEDS_REVIEW');
    }
  } else {
    push('initials', null, null, 'NEEDS_REVIEW', ['Depends on first names']);
  }

  const dobMatch = extractLabelledValue(lines, ['date of birth', 'gebore', 'geboorte']);
  const dobNormalized = dobMatch ? normalizeDate(dobMatch.value) : null;
  if (dobNormalized) push('dateOfBirth', dobNormalized, 0.7, 'UNKNOWN');
}
