/**
 * Document processing pipeline types.
 *
 * The pipeline:
 *   Upload -> Store Original -> Create Document -> Create Processing Job
 *   -> Preprocess -> Barcode Detection -> OCR -> Field Extraction ->
 *   Normalization -> Validation -> Confidence Scoring -> Cross-document
 *   Validation -> Save Results -> Recalculate Price
 *
 * OCR is never run synchronously inside the upload HTTP request. Instead a
 * `ProcessingJob` represents a long-running async task; the job runner (or
 * manual trigger) executes the steps and writes results back to the database.
 */
export {}

/* Extraction sources enum mapped to DB 'extraction_source' column. */
export type ExtractionSource =
  | 'OCR'
  | 'BARCODE'
  | 'MANUAL'
  | 'SYSTEM'
  | 'CALCULATED';

export type ExtractionStatus =
  | 'PENDING'
  | 'OCR_DONE'
  | 'BARCODE_DONE'
  | 'EXTRACTION_DONE'
  | 'VALIDATED'
  | 'MANUAL_CORRECTION_DONE'
  | 'REJECTED';

export type FieldValidationStatus =
  | 'VALID'
  | 'INVALID'
  | 'NEEDS_REVIEW'
  | 'UNKNOWN';
