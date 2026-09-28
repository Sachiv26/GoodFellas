/**
 * Proof-of-residence extraction.
 *
 * The platform does NOT assume a specific proof-of-residence format: municipal
 * bills, bank statements, utility bills, leases and affidavits are all valid.
 * Extraction therefore works off generic labels plus a conservative address
 * block heuristic. Any value that cannot be reliably located stays null with
 * validationStatus NEEDS_REVIEW — nothing is ever fabricated.
 */
import type { ExtractionSource } from '@prisma/client';
import type { ExtractedField } from './types';
import { groupWordsIntoLines, extractLabelledValue, type OcrLine } from './line-utils';
import {
  normalizeNameCase,
  normalizeWhitespace,
  digitsOnly,
  normalizeDate,
  normalizePostalCode,
} from './normalizers';
import { validateSouthAfricanId, normalizeIdCandidate } from '@/lib/validation/sa-id';

export interface PorExtractionInput {
  rawText: string;
  words: Array<{
    text: string;
    confidence: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
  source?: ExtractionSource;
}

export const SA_PROVINCES = [
  'Eastern Cape',
  'Free State',
  'Gauteng',
  'KwaZulu-Natal',
  'Limpopo',
  'Mpumalanga',
  'Northern Cape',
  'North West',
  'Western Cape',
] as const;

const STREET_TOKENS =
  /\b(street|str|st\.|road|rd\.|avenue|ave\.|drive|dr\.|lane|ln\.|crescent|cres\.|close|cl\.|way|place|pl\.|boulevard|blvd|highway|section|unit|complex|flat|flats|apartment|farm|plot|stand)\b/i;

type Push = (
  fieldName: string,
  value: string | null,
  confidence: number | null,
  status: ExtractedField['validationStatus'],
  notes?: string[],
  bbox?: ExtractedField['boundingBox']
) => void;

export function extractProofOfResidenceFields(input: PorExtractionInput): ExtractedField[] {
  const { rawText, words, source = 'OCR' } = input;
  const fields: ExtractedField[] = [];
  const push: Push = (fieldName, value, confidence, status, notes, bbox) => {
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

  const lines: OcrLine[] = words.length
    ? groupWordsIntoLines(words)
    : normalizeWhitespace(rawText)
        .split('\n')
        .filter(Boolean)
        .map((t) => ({ text: t, confidence: 0.4 }));

  extractIdNumber(lines, push);
  extractPersonNames(lines, push);
  extractAddress(lines, push);
  extractDocumentMeta(lines, push);
  return fields;
}

function extractIdNumber(lines: OcrLine[], push: Push): void {
  const labelled = extractLabelledValue(lines, [
    'id number',
    'identity number',
    'id no',
    'identiteitsnommer',
    'identity no',
  ]);
  const candidates: string[] = [];
  if (labelled) candidates.push(normalizeIdCandidate(labelled.value));
  for (const line of lines) {
    for (const raw of line.text.match(/\b\d[\d\s-]{10,}\d\b/g) ?? []) {
      const digits = digitsOnly(raw);
      if (digits.length === 13) candidates.push(digits);
    }
  }
  for (const candidate of candidates) {
    if (candidate.length !== 13) continue;
    const validation = validateSouthAfricanId(candidate);
    if (validation.valid) {
      push('idNumber', candidate, labelled ? 0.8 : 0.6, 'VALID');
      return;
    }
  }
  if (candidates[0]) {
    push('idNumber', candidates[0], 0.4, 'NEEDS_REVIEW', [
      '13-digit number found but failed ID validation (checksum/date)',
    ]);
    return;
  }
  push('idNumber', null, null, 'NEEDS_REVIEW', ['No 13-digit identification number found']);
}

function extractPersonNames(lines: OcrLine[], push: Push): void {
  const firstNames = extractLabelledValue(lines, [
    'first names',
    'first name',
    'initials and names',
    'name and initials',
    'given names',
    'name of account holder',
    'account holder',
    'customer name',
  ]);
  const surname = extractLabelledValue(lines, ['surname', 'last name', 'family name', 'van']);

  if (surname) {
    push('surname', normalizeNameCase(surname.value), 0.7, 'UNKNOWN');
  } else {
    push('surname', null, null, 'NEEDS_REVIEW', ['Surname label not found']);
  }

  if (firstNames) {
    // A single "name" source is kept as `name` (the honour-form section maps
    // surname/first names explicitly); the customer is never shown raw OCR.
    push('name', normalizeNameCase(firstNames.value), 0.6, 'UNKNOWN');
  } else {
    push('name', null, null, 'NEEDS_REVIEW', ['Name label not found']);
  }
}

function extractAddress(lines: OcrLine[], push: Push): void {
  const labelledStreet = extractLabelledValue(lines, [
    'street address',
    'physical address',
    'residential address',
    'property address',
    'address',
  ]);
  const labelledLine2 = extractLabelledValue(lines, ['address line 2', 'unit number', 'complex']);
  const labelledSuburb = extractLabelledValue(lines, ['suburb', 'voorstad', 'township']);
  const labelledCity = extractLabelledValue(lines, ['city', 'town', 'stad', 'dorp', 'municipality']);
  const labelledProvince = extractLabelledValue(lines, ['province', 'provinsie']);
  const labelledPostal = extractLabelledValue(lines, ['postal code', 'postcode', 'poskode', 'zip']);

  const block = detectAddressBlock(lines);

  const addressLine1 = labelledStreet?.value ?? block?.line1 ?? null;
  const addressLine2 = labelledLine2?.value ?? block?.line2 ?? null;

  if (addressLine1) {
    push(
      'addressLine1',
      normalizeWhitespace(addressLine1),
      labelledStreet ? 0.75 : 0.5,
      STREET_TOKENS.test(addressLine1) ? 'VALID' : 'NEEDS_REVIEW',
      labelledStreet ? undefined : ['Address block heuristic (no street-address label found)']
    );
  } else {
    push('addressLine1', null, null, 'NEEDS_REVIEW', ['No street address located']);
  }

  if (addressLine2) {
    push('addressLine2', normalizeWhitespace(addressLine2), labelledLine2 ? 0.7 : 0.45, 'UNKNOWN');
  } else {
    push('addressLine2', null, null, 'UNKNOWN', ['No second address line located']);
  }

  const suburb = labelledSuburb?.value ?? block?.suburb ?? null;
  if (suburb) {
    push('suburb', normalizeNameCase(suburb), labelledSuburb ? 0.75 : 0.5, 'UNKNOWN');
  } else {
    push('suburb', null, null, 'NEEDS_REVIEW', ['Suburb not located']);
  }

  const city = labelledCity?.value ?? block?.city ?? null;
  if (city) {
    push('city', normalizeNameCase(city), labelledCity ? 0.75 : 0.5, 'UNKNOWN');
  } else {
    push('city', null, null, 'NEEDS_REVIEW', ['City/town not located']);
  }

  const province = labelledProvince?.value ?? findProvince(lines) ?? block?.province ?? null;
  if (province) {
    const isKnown = SA_PROVINCES.some(
      (p) => p.toLowerCase() === normalizeWhitespace(province).toLowerCase()
    );
    push(
      'province',
      normalizeNameCase(province),
      isKnown ? 0.8 : 0.5,
      isKnown ? 'VALID' : 'NEEDS_REVIEW',
      isKnown ? undefined : ['Province is not a recognised SA province']
    );
  } else {
    push('province', null, null, 'NEEDS_REVIEW', ['Province not located']);
  }

  const postalCode = labelledPostal
    ? normalizePostalCode(labelledPostal.value)
    : block?.postalCode ?? null;
  if (postalCode) {
    push('postalCode', postalCode, labelledPostal ? 0.8 : 0.5, 'VALID');
  } else {
    push('postalCode', null, null, 'NEEDS_REVIEW', ['Postal code not located']);
  }
}

interface AddressBlock {
  line1: string;
  line2: string | null;
  suburb: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
}

/**
 * Conservative address block detection: locate a line containing a street
 * token, then take the following 1-5 short lines as locality data. Stops at a
 * line that looks like a different section. When nothing convincing is found
 * this returns null so the admin reviews instead of being shown a guess.
 */
function detectAddressBlock(lines: OcrLine[]): AddressBlock | null {
  const stopPattern =
    /(vat|invoice|statement|account|balance|due\b|total|terms|date|thank|page|reg no|meter|reading|bank|branch)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!STREET_TOKENS.test(line.text)) continue;
    if (stopPattern.test(line.text)) continue;
    if (line.text.length > 90) continue;

    const following: string[] = [];
    for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
      const next = lines[j]!;
      if (stopPattern.test(next.text)) break;
      if (next.text.length > 60) break;
      following.push(next.text);
    }

    let postalCode: string | null = null;
    let province: string | null = null;
    const leftovers: string[] = [];
    for (const text of following) {
      const postal = normalizePostalCode(text);
      if (postal && !postalCode) {
        postalCode = postal;
        const provinceInLine = SA_PROVINCES.find((p) => text.toLowerCase().includes(p.toLowerCase()));
        if (provinceInLine) province = provinceInLine;
        const city = normalizeWhitespace(text.replace(postal, '')).replace(/[,-]/g, '').trim();
        if (city) leftovers.push(city);
        continue;
      }
      leftovers.push(text);
    }

    return {
      line1: line.text,
      line2: null,
      suburb: leftovers[0] ?? null,
      city: leftovers[1] ?? leftovers[0] ?? null,
      province,
      postalCode,
    };
  }
  return null;
}

function findProvince(lines: OcrLine[]): string | null {
  for (const line of lines) {
    const match = SA_PROVINCES.find((p) => line.text.toLowerCase().includes(p.toLowerCase()));
    if (match) return match;
  }
  return null;
}

function extractDocumentMeta(lines: OcrLine[], push: Push): void {
  const labelledDate = extractLabelledValue(lines, [
    'statement date',
    'invoice date',
    'tax invoice date',
    'date of issue',
    'issued on',
    'document date',
    'bill date',
  ]);
  const normalizedDate = labelledDate ? normalizeDate(labelledDate.value) : findLatestDate(lines);
  if (normalizedDate) {
    push(
      'documentDate',
      normalizedDate,
      labelledDate ? 0.7 : 0.4,
      'UNKNOWN',
      labelledDate ? undefined : ['Date taken from the most recent valid date in the document']
    );
  } else {
    push('documentDate', null, null, 'NEEDS_REVIEW', ['No document date located']);
  }

  const issuer = extractLabelledValue(lines, ['issued by', 'supplier', 'service provider', 'billing entity']);
  if (issuer) {
    push('issuer', normalizeWhitespace(issuer.value), 0.6, 'UNKNOWN');
  } else {
    push('issuer', null, null, 'NEEDS_REVIEW', ['Issuer not located']);
  }

  const account = extractLabelledValue(lines, [
    'account number',
    'account no',
    'rekeningnommer',
    'customer number',
    'contract number',
    'policy number',
  ]);
  if (account) {
    const value = digitsOnly(account.value) || normalizeWhitespace(account.value);
    push('accountNumber', value, 0.7, 'UNKNOWN');
  } else {
    push('accountNumber', null, null, 'UNKNOWN', ['Account number not located']);
  }

  const reference = extractLabelledValue(lines, [
    'reference number',
    'invoice number',
    'invoice no',
    'meter number',
    'statement number',
    'reference',
  ]);
  if (reference) {
    push('referenceNumber', normalizeWhitespace(reference.value), 0.65, 'UNKNOWN');
  } else {
    push('referenceNumber', null, null, 'UNKNOWN', ['Reference number not located']);
  }
}

function findLatestDate(lines: OcrLine[]): string | null {
  let best: { iso: string; time: number } | null = null;
  for (const line of lines) {
    const matches =
      line.text.match(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g) ?? [];
    for (const raw of matches) {
      const iso = normalizeDate(raw);
      if (!iso) continue;
      const time = Date.parse(iso);
      if (Number.isNaN(time)) continue;
      if (time > Date.now() + 24 * 60 * 60 * 1000) continue;
      if (!best || time > best.time) best = { iso, time };
    }
  }
  return best?.iso ?? null;
}

