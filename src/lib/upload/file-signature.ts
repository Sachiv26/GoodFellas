/**
 * Upload content verification.
 *
 * The browser-supplied `File.type` and the file name extension are both
 * attacker-controlled, so they are only used as a first gate. The bytes
 * themselves are checked against the magic number of each allowed format: a
 * file whose contents do not match its declared MIME type is rejected before
 * anything is written to private storage.
 *
 * This blocks the common "JPEG extension + HTML/SVG/script payload" upload that
 * would otherwise be stored and later served or parsed as active content.
 */

export type FileSignature = 'jpeg' | 'png' | 'pdf';

/** MIME types accepted for each detected signature (aliases included). */
const SIGNATURE_MIME_TYPES: Record<FileSignature, readonly string[]> = {
  jpeg: ['image/jpeg', 'image/jpg'],
  png: ['image/png'],
  pdf: ['application/pdf'],
};

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF_MAGIC = '%PDF-';

/** Detect the real container format from the leading bytes, or null if unknown. */
export function detectFileSignature(buffer: Buffer): FileSignature | null {
  if (!buffer || buffer.length < 8) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return 'png';
  if (buffer.subarray(0, PDF_MAGIC.length).toString('latin1') === PDF_MAGIC) return 'pdf';
  return null;
}

/**
 * True only when the bytes really are the format the client claims.
 * Unknown signatures (empty, truncated, or unsupported content) return false.
 */
export function signatureMatchesMime(buffer: Buffer, mimeType: string): boolean {
  const signature = detectFileSignature(buffer);
  if (!signature) return false;
  return SIGNATURE_MIME_TYPES[signature].includes((mimeType ?? '').toLowerCase());
}

/** Extension that matches the detected signature (used to keep keys honest). */
export function signatureExtension(signature: FileSignature): string {
  return signature === 'jpeg' ? 'jpg' : signature;
}
