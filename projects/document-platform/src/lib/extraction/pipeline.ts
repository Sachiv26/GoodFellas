/**
 * Document processing pipeline orchestration.
 *
 * Coordinates the stages described in the architecture:
 *   Upload -> Store Original -> Create Document -> Create Processing Job
 *   -> Preprocess -> Barcode Detection -> OCR -> Field Extraction ->
 *   Normalization -> Validation -> Confidence Scoring -> Cross-document
 *   Validation -> Save Results -> Recalculate Price
 *
 * Expensive OCR is never run synchronously in the upload request.
 */
export {}
