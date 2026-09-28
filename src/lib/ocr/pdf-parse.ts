/**
 * PDF text-layer extraction (via pdf-parse — open source).
 *
 * For PDF uploads we first try extracting embedded text. If the PDF has no
 * extractable text layer (typical scanned documents), callers fall back to
 * rasterizing via mupdf and running Tesseract OCR.
 *
 * Returns null when no text can be extracted — callers must fall back to OCR
 * or flag for review, never guess at content.
 */
import pdfParse from 'pdf-parse';

export async function parsePdfText(input: Buffer): Promise<string | null> {
  try {
    const result = await pdfParse(input);
    const trimmed = (result?.text ?? '').trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
