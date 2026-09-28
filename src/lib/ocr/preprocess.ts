/**
 * Image preprocessing for OCR via sharp: grayscale, normalize contrast,
 * upscale small images. Improves tesseract accuracy substantially on
 * phone photos of IDs and licence discs.
 */
import sharp from 'sharp';

export interface PreprocessResult {
  buffer: Buffer;
  width: number;
  height: number;
  format: string;
}

export async function preprocessForOcr(
  input: Buffer,
  isPdf = false
): Promise<PreprocessResult> {
  if (isPdf) {
    // PDFs are passed through for OCR-in-PDF handling later; text-layer
    // extraction is attempted before raster OCR by the pipeline.
    return { buffer: input, width: 0, height: 0, format: 'pdf' };
  }
  const image = sharp(input, { failOn: 'error' }).rotate();
  const meta = await image.metadata();
  let pipeline = image
    .grayscale()
    .normalize()
    .sharpen({ sigma: 1 });

  const width = meta.width ?? 0;
  if (width > 0 && width < 1000) {
    pipeline = pipeline.resize({ width: 1400, withoutEnlargement: false });
  }

  const { data, info } = await pipeline.png().toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, format: 'png' };
}

/** Extract raw grayscale pixel data for barcode decoding. */
export async function extractRawPixels(
  input: Buffer
): Promise<{ data: Uint8Array; width: number; height: number } | null> {
  try {
    const { data, info } = await sharp(input, { failOn: 'error' })
      .rotate()
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), width: info.width, height: info.height };
  } catch {
    return null;
  }
}
