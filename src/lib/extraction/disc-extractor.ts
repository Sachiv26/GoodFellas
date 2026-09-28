/**
 * Motor vehicle licence disc field mapping.
 *
 * The disc BARCODE is the only data source for this document type. There is no
 * OCR and no AI/vision extraction anywhere in this application, so this module
 * never looks at the printed face of the disc â€” it maps the values decoded from
 * the barcode onto named fields.
 *
 * Every value must pass the structural validator for its field before it is
 * accepted; a value that fails is dropped with a note rather than used to set a
 * price. Anything the barcode does not carry is left null with
 * validationStatus NEEDS_REVIEW. Missing information is NEVER invented.
 */
import type { ExtractionSource } from '@prisma/client';
import type { ExtractedField } from './types';
import { BARCODE_FIELD_VALIDATORS } from './barcode-parser';
import { DISC_FIELDS } from './types';

export interface DiscExtractionInput {
  /** Structured values decoded from the disc barcode. */
  barcodeFields?: Record<string, string | null | undefined> | null;
  barcodeConfidence?: number | null;
  source?: ExtractionSource;
}

/** Fallback confidence when the decoder did not report one. */
const DEFAULT_BARCODE_CONFIDENCE = 0.9;

export function extractLicenceDiscFields(
  input: DiscExtractionInput
): ExtractedField[] {
  const { barcodeFields, barcodeConfidence, source = 'BARCODE' } = input;
  const confidence = barcodeConfidence ?? DEFAULT_BARCODE_CONFIDENCE;

  return DISC_FIELDS.map((fieldName): ExtractedField => {
    const raw = barcodeFields?.[fieldName] ?? null;
    const validator = BARCODE_FIELD_VALIDATORS[fieldName];

    if (raw && (!validator || validator(raw))) {
      return {
        fieldName,
        value: raw,
        normalizedValue: raw.trim(),
        confidence,
        source: 'BARCODE',
        boundingBox: null,
        validationStatus: 'VALID',
      };
    }
    if (raw) {
      return {
        fieldName,
        value: null,
        normalizedValue: null,
        confidence: null,
        source,
        boundingBox: null,
        validationStatus: 'NEEDS_REVIEW',
        validationNotes: [
          'Barcode supplied a value that failed structural validation â€” ignored',
        ],
      };
    }
    return {
      fieldName,
      value: null,
      normalizedValue: null,
      confidence: null,
      source,
      boundingBox: null,
      validationStatus: 'NEEDS_REVIEW',
      validationNotes: ['Not present in the licence disc barcode'],
    };
  });
}
