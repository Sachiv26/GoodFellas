/**
 * Barcode-derived field registry.
 *
 * There is NO OCR and NO AI extraction in this application. The licence disc
 * barcode is the only machine-readable document data source, so this module
 * exposes just the disc field mapping and the serialisation helper. The ID and
 * proof-of-residence extractors were removed along with the AI providers.
 */
import type { ExtractedField } from './types';
import { EXTRACTION_VERSION } from './types';

export * from './types';
export { EXTRACTION_VERSION };
export {
  ENATIS_SEGMENT_FIELDS,
  parseDiscBarcode,
  DEFAULT_BARCODE_FIELD_ORDER,
  BARCODE_FIELD_VALIDATORS,
} from './barcode-parser';

export const DOCUMENT_TYPE_CODES = {
  SOUTH_AFRICAN_ID: 'SOUTH_AFRICAN_ID',
  PROOF_OF_RESIDENCE: 'PROOF_OF_RESIDENCE',
  VEHICLE_LICENCE_DISC: 'VEHICLE_LICENCE_DISC',
} as const;

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

