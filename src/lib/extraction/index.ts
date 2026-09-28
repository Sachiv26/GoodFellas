/**
 * Extraction registry — maps a DocumentType code to its extractor.
 *
 * Isolation keeps document-specific logic separate from the pipeline, so a new
 * product/document type only needs a new extractor module plus configuration.
 */
import type { CrossValidationInput, ExtractedField } from './types';
import { EXTRACTION_VERSION } from './types';
import { extractIdFields } from './id-extractor';
import { extractProofOfResidenceFields } from './por-extractor';
import { extractLicenceDiscFields } from './disc-extractor';

export * from './types';
export * from './cross-validation';
export { EXTRACTION_VERSION };

export interface ExtractionInput {
  rawText: string;
  words: Array<{
    text: string;
    confidence: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
  source?: ExtractedField['source'];
  barcodeFields?: Record<string, string | null | undefined> | null;
  barcodeConfidence?: number | null;
}

export type DocumentExtractor = (input: ExtractionInput) => ExtractedField[];

export const DOCUMENT_TYPE_CODES = {
  SOUTH_AFRICAN_ID: 'SOUTH_AFRICAN_ID',
  PROOF_OF_RESIDENCE: 'PROOF_OF_RESIDENCE',
  VEHICLE_LICENCE_DISC: 'VEHICLE_LICENCE_DISC',
} as const;

const REGISTRY: Record<string, DocumentExtractor> = {
  [DOCUMENT_TYPE_CODES.SOUTH_AFRICAN_ID]: (input) =>
    extractIdFields({ rawText: input.rawText, words: input.words, source: input.source }),
  [DOCUMENT_TYPE_CODES.PROOF_OF_RESIDENCE]: (input) =>
    extractProofOfResidenceFields({
      rawText: input.rawText,
      words: input.words,
      source: input.source,
    }),
  [DOCUMENT_TYPE_CODES.VEHICLE_LICENCE_DISC]: (input) =>
    extractLicenceDiscFields({
      rawText: input.rawText,
      words: input.words,
      source: input.source,
      barcodeFields: input.barcodeFields,
      barcodeConfidence: input.barcodeConfidence,
    }),
};

export function getExtractor(documentTypeCode: string): DocumentExtractor | null {
  return REGISTRY[documentTypeCode] ?? null;
}

export function supportedDocumentTypes(): string[] {
  return Object.keys(REGISTRY);
}

export interface ExtractionRunResult {
  version: string;
  fields: ExtractedField[];
  /** Mean confidence across fields that produced a value (null when none did). */
  overallConfidence: number | null;
}

export function runExtraction(
  documentTypeCode: string,
  input: ExtractionInput
): ExtractionRunResult {
  const extractor = getExtractor(documentTypeCode);
  if (!extractor) {
    return { version: EXTRACTION_VERSION, fields: [], overallConfidence: null };
  }
  const fields = extractor(input);
  const scored = fields.filter((f) => f.value !== null && f.confidence !== null);
  const overallConfidence = scored.length
    ? scored.reduce((sum, f) => sum + (f.confidence ?? 0), 0) / scored.length
    : null;
  return { version: EXTRACTION_VERSION, fields, overallConfidence };
}

/**
 * Build a CrossValidationInput from persisted extractions.
 * Used by the processing pipeline to compare facts across documents.
 */
export function buildCvInput(docs: Array<{
  documentType: { code: string };
  extractions: Array<{ fieldExtractions: ReadonlyArray<{ fieldName: string; normalizedValue: string | null; value: string | null }> }>;
}>): CrossValidationInput {
  const out: CrossValidationInput = {};
  for (const doc of docs) {
    const extraction = doc.extractions[0];
    if (!extraction) continue;
    const fields: Record<string, string | null | undefined> = {};
    for (const field of extraction.fieldExtractions) {
      fields[field.fieldName] = field.normalizedValue ?? field.value ?? undefined;
    }
    if (doc.documentType.code === DOCUMENT_TYPE_CODES.SOUTH_AFRICAN_ID) {
      out.id = fields;
    } else if (doc.documentType.code === DOCUMENT_TYPE_CODES.PROOF_OF_RESIDENCE) {
      out.proofOfResidence = fields;
    } else if (doc.documentType.code === DOCUMENT_TYPE_CODES.VEHICLE_LICENCE_DISC) {
      out.licenceDisc = fields;
    }
  }
  return out;
}

/** Serialize extracted fields into the generic `extractedJson` shape. */
export function fieldsToJson(fields: ExtractedField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    out[field.fieldName] = {
      value: field.value,
      normalizedValue: field.normalizedValue,
      confidence: field.confidence,
      source: field.source,
      validationStatus: field.validationStatus,
      validationNotes: field.validationNotes ?? [],
    };
  }
  return out;
}
