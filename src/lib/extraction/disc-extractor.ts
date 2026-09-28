/**
 * Motor vehicle licence disc extraction.
 *
 * Two data sources feed this extractor:
 *   1. A decoded barcode (source BARCODE) — highest confidence when valid.
 *   2. OCR of the disc face (source OCR).
 *
 * Barcode values take precedence, but only when they pass the structural
 * validator for that field. Anything that cannot be determined is left null
 * with validationStatus NEEDS_REVIEW. Missing information is NEVER invented
 * and OCR failures are never interpreted as "no odometer".
 */
import type { ExtractionSource } from '@prisma/client';
import type { ExtractedField } from './types';
import { groupWordsIntoLines, extractLabelledValue, type OcrLine } from './line-utils';
import { normalizeWhitespace, digitsOnly, normalizeDate } from './normalizers';

export interface DiscExtractionInput {
  rawText: string;
  words: Array<{
    text: string;
    confidence: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
  source?: ExtractionSource;
  /** Structured values decoded from the disc barcode, if any. */
  barcodeFields?: Record<string, string | null | undefined> | null;
  barcodeConfidence?: number | null;
}

/** SA vehicle registration: e.g. ABC123GP, AB12CDGP, CAA123456, ND123-456 */
const REGISTRATION_REGEXES = [
  /\b[A-Z]{1,3}\s?\d{1,3}\s?-?\s?\d{1,4}\s?(?:GP|ZN|ND|EC|FS|MP|NC|NW|WC|L|N|C|T|E|J|B|D|G|H|K|M|P|A|O|X)\b/,
  /\b[A-Z]{2,3}\s?\d{2,6}\b/,
];

const VIN_REGEX = /\b[A-HJ-NPR-Z0-9]{17}\b/;
const ENGINE_REGEX = /\b[A-Z0-9]{6,20}\b/;

export interface DiscFieldMap {
  key: string;
  value: string | null;
}

export function extractLicenceDiscFields(input: DiscExtractionInput): ExtractedField[] {
  const { rawText, words, source = 'OCR', barcodeFields, barcodeConfidence } = input;
  const fields: ExtractedField[] = [];
  const push = (
    fieldName: string,
    value: string | null,
    confidence: number | null,
    status: ExtractedField['validationStatus'],
    notes?: string[]
  ) => {
    fields.push({
      fieldName,
      value,
      normalizedValue: value ? value.trim() : null,
      confidence,
      source,
      boundingBox: null,
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
  const fullText = normalizeWhitespace(rawText).toUpperCase();

  /**
   * Resolve a field: barcode first (when structurally valid), else OCR.
   * Records which source actually supplied the value so downstream pricing and
   * PDF generation can trust it.
   */
  const resolve = (
    fieldName: string,
    ocrValue: string | null,
    ocrConfidence: number | null,
    validator: (v: string) => boolean,
    barcodeKey?: string
  ) => {
    const rawBarcode = barcodeKey ? barcodeFields?.[barcodeKey] ?? null : null;
    if (rawBarcode && validator(rawBarcode)) {
      fields.push({
        fieldName,
        value: rawBarcode,
        normalizedValue: rawBarcode.trim(),
        confidence: barcodeConfidence ?? 0.9,
        source: 'BARCODE',
        boundingBox: null,
        validationStatus: 'VALID',
      });
      return;
    }
    if (ocrValue && validator(ocrValue)) {
      push(fieldName, ocrValue, ocrConfidence, 'VALID');
      return;
    }
    if (ocrValue) {
      push(fieldName, ocrValue, ocrConfidence, 'NEEDS_REVIEW', [
        'Value found but failed structural validation — admin review required',
      ]);
      return;
    }
    if (rawBarcode && !validator(rawBarcode)) {
      push(fieldName, null, null, 'NEEDS_REVIEW', [
        'Barcode supplied a value that failed structural validation — ignored',
      ]);
      return;
    }
    push(fieldName, null, null, 'NEEDS_REVIEW', ['Not present in barcode or OCR output']);
  };

  // ── registration number ────────────────────────────────────────────────
  const regLabelled = extractLabelledValue(lines, [
    'registration number',
    'registration no',
    'reg no',
    'registrasienommer',
    'registrasie nr',
  ]);
  const regOcr = regLabelled?.value ?? matchFirst(fullText, REGISTRATION_REGEXES);
  resolve(
    'registrationNumber',
    regOcr ? cleanRegistration(regOcr) : null,
    regLabelled ? 0.8 : 0.5,
    (v) => REGISTRATION_REGEXES.some((r) => r.test(v.toUpperCase())),
    'registrationNumber'
  );

  // ── licence number (distinct from registration number) ─────────────────
  const licenceLabelled = extractLabelledValue(lines, [
    'licence number',
    'license number',
    'licence no',
    'lisensienommer',
  ]);
  const licenceOcr = licenceLabelled ? digitsOnly(licenceLabelled.value) : null;
  resolve(
    'licenceNumber',
    licenceOcr,
    licenceLabelled ? 0.75 : null,
    (v) => /^\d{4,12}$/.test(digitsOnly(v)),
    'licenceNumber'
  );

  // ── vehicle register number ────────────────────────────────────────────
  const registerLabelled = extractLabelledValue(lines, [
    'vehicle register number',
    'vehicle register no',
    'register number',
    'voertuigregisternommer',
  ]);
  resolve(
    'vehicleRegisterNumber',
    registerLabelled ? normalizeWhitespace(registerLabelled.value).toUpperCase() : null,
    registerLabelled ? 0.7 : null,
    (v) => /^[A-Z0-9-]{4,20}$/.test(v.toUpperCase()),
    'vehicleRegisterNumber'
  );

  // ── owner particulars (as printed on the disc) ─────────────────────────
  const ownerLabelled = extractLabelledValue(lines, ['owner', 'registered owner', 'eienaar']);
  resolve(
    'ownerName',
    ownerLabelled ? normalizeWhitespace(ownerLabelled.value) : null,
    ownerLabelled ? 0.65 : null,
    (v) => v.length >= 3 && /[A-Za-z]/.test(v),
    'ownerName'
  );

  const ownerIdLabelled = extractLabelledValue(lines, ['identity number', 'id number', 'owner id']);
  const ownerIdOcr = ownerIdLabelled
    ? digitsOnly(ownerIdLabelled.value).slice(0, 13)
    : matchFirst(fullText.replace(/[^0-9\s]/g, ' '), [/\b\d{13}\b/]);
  resolve('ownerIdNumber', ownerIdOcr, ownerIdLabelled ? 0.7 : 0.5, (v) => /^\d{13}$/.test(digitsOnly(v)), 'ownerIdNumber');

  // ── VIN / chassis ──────────────────────────────────────────────────────
  const vinLabelled = extractLabelledValue(lines, [
    'chassis number',
    'chassis no',
    'vin',
    'vehicle identification number',
    'onderstelnommer',
  ]);
  const vinOcr = vinLabelled ? normalizeWhitespace(vinLabelled.value).toUpperCase() : matchFirst(fullText, [VIN_REGEX]);
  resolve('vin', vinOcr, vinLabelled ? 0.75 : 0.55, (v) => VIN_REGEX.test(v.toUpperCase()), 'vin');
  resolve(
    'chassisNumber',
    vinOcr && !VIN_REGEX.test(vinOcr) ? vinOcr : null,
    vinLabelled ? 0.6 : null,
    (v) => v.replace(/\s/g, '').length >= 6,
    'chassisNumber'
  );

  // ── engine number ──────────────────────────────────────────────────────
  const engineLabelled = extractLabelledValue(lines, ['engine number', 'engine no', 'enjinnommer']);
  resolve(
    'engineNumber',
    engineLabelled ? normalizeWhitespace(engineLabelled.value).toUpperCase() : null,
    engineLabelled ? 0.7 : null,
    (v) => ENGINE_REGEX.test(v.toUpperCase()),
    'engineNumber'
  );

  // ── make / model / series / type ───────────────────────────────────────
  const makeLabelled = extractLabelledValue(lines, ['make', 'fabrikaat', 'manufacturer']);
  resolve(
    'make',
    makeLabelled ? normalizeWhitespace(makeLabelled.value).toUpperCase() : null,
    makeLabelled ? 0.7 : null,
    (v) => /^[A-Z0-9 .\-]{2,30}$/.test(v.toUpperCase()),
    'make'
  );

  const modelLabelled = extractLabelledValue(lines, ['model', 'modelle']);
  resolve(
    'model',
    modelLabelled ? normalizeWhitespace(modelLabelled.value).toUpperCase() : null,
    modelLabelled ? 0.65 : null,
    (v) => /^[A-Z0-9 .\-]{1,40}$/.test(v.toUpperCase()),
    'model'
  );

  const seriesLabelled = extractLabelledValue(lines, ['series name', 'series', 'reeksnaam']);
  resolve(
    'seriesName',
    seriesLabelled ? normalizeWhitespace(seriesLabelled.value).toUpperCase() : null,
    seriesLabelled ? 0.7 : null,
    (v) => /^[A-Z0-9 .\-/]{1,40}$/.test(v.toUpperCase()),
    'seriesName'
  );

  const typeLabelled = extractLabelledValue(lines, [
    'vehicle type',
    'type of vehicle',
    'voertuigtipe',
  ]);
  resolve(
    'vehicleType',
    typeLabelled ? normalizeWhitespace(typeLabelled.value).toUpperCase() : null,
    typeLabelled ? 0.6 : null,
    (v) => v.length >= 3,
    'vehicleType'
  );

  // ── weights ────────────────────────────────────────────────────────────
  const tareLabelled = extractLabelledValue(lines, ['tare', 'tare weight', 'tarra']);
  const tareOcr = tareLabelled ? digitsOnly(tareLabelled.value) : null;
  resolve('tareWeight', tareOcr, tareLabelled ? 0.7 : null, (v) => /^\d{2,6}$/.test(digitsOnly(v)), 'tareWeight');

  const gvmLabelled = extractLabelledValue(lines, ['gvm', 'g.v.m', 'gross vehicle mass', 'bruto voertuigmassa']);
  const gvmOcr = gvmLabelled ? digitsOnly(gvmLabelled.value) : null;
  resolve('gvm', gvmOcr, gvmLabelled ? 0.7 : null, (v) => /^\d{2,7}$/.test(digitsOnly(v)), 'gvm');

  // ── dates ──────────────────────────────────────────────────────────────
  const issueLabelled = extractLabelledValue(lines, ['issue date', 'date of issue', 'uitreikingsdatum', 'issued']);
  resolve(
    'issueDate',
    issueLabelled ? normalizeDate(issueLabelled.value) : null,
    issueLabelled ? 0.7 : null,
    (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
    'issueDate'
  );

  const expiryLabelled = extractLabelledValue(lines, [
    'expiry date',
    'expires',
    'valid until',
    'vervaldatum',
    'expiry',
  ]);
  resolve(
    'expiryDate',
    expiryLabelled ? normalizeDate(expiryLabelled.value) : null,
    expiryLabelled ? 0.75 : null,
    (v) => /^\d{4}-\d{2}-\d{2}$/.test(v),
    'expiryDate'
  );

  const discLabelled = extractLabelledValue(lines, ['disc number', 'disc no', 'skyf nommer']);
  resolve(
    'discNumber',
    discLabelled ? normalizeWhitespace(discLabelled.value).toUpperCase() : null,
    discLabelled ? 0.7 : null,
    (v) => /^[A-Z0-9\-/]{3,20}$/.test(v.toUpperCase()),
    'discNumber'
  );

  // ── odometer ───────────────────────────────────────────────────────────
  // NOTE: the ALV(9) "no odometer" checkbox is only ever checked when the
  // source explicitly states it. A missing odometer here NEVER implies that.
  const odometerLabelled = extractLabelledValue(lines, [
    'odometer',
    'odometer reading',
    'kilometers',
    'kilometres',
    'km',
  ]);
  const odometerOcr = odometerLabelled ? digitsOnly(odometerLabelled.value) : null;
  resolve(
    'odometer',
    odometerOcr,
    odometerLabelled ? 0.6 : null,
    (v) => /^\d{1,7}$/.test(digitsOnly(v)),
    'odometer'
  );

  return fields;
}

function matchFirst(text: string, regexes: RegExp[]): string | null {
  for (const regex of regexes) {
    const m = text.match(regex);
    if (m) return m[0];
  }
  return null;
}

/** Normalize a registration number: strip spaces inside the numeric block. */
function cleanRegistration(raw: string): string {
  const upper = normalizeWhitespace(raw).toUpperCase();
  return upper.replace(/\s{2,}/g, ' ').replace(/-\s/g, '-');
}
