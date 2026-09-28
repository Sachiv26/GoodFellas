/**
 * Barcode decoding abstraction using ZXing (open source).
 * Works on raw grayscale pixel data produced by sharp, so it runs in Node.
 */
import {
  BinaryBitmap,
  HybridBinarizer,
  GlobalHistogramBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
  DecodeHintType,
  BarcodeFormat,
  NotFoundException,
  type Result,
  type ResultPoint,
} from '@zxing/library';
import type { extractRawPixels } from '@/lib/ocr/preprocess';
import sharp from 'sharp';

export interface BarcodeResult {
  rawValue: string;
  symbology: string;
  confidence: number;
  decodedAt: string;
}

export interface BarcodeProvider {
  readonly name: string;
  decode(
    pixels: { data: Uint8Array; width: number; height: number } | null
  ): Promise<BarcodeResult | null>;
  /**
   * Decode from the original image bytes.
   *
   * Preferred over `decode` where the source is available: a licence disc
   * photographed at ~400px is too small for ZXing to resolve the PDF417 module
   * widths, so the decoder retries at increasing scales. Decoding a
   * pre-downscaled raster would silently fail.
   */
  decodeImage?(source: Buffer): Promise<BarcodeResult | null>;
}

export class ZxingBarcodeProvider implements BarcodeProvider {
  readonly name = 'zxing';

  async decode(
    pixels: Awaited<ReturnType<typeof extractRawPixels>>
  ): Promise<BarcodeResult | null> {
    if (!pixels || pixels.width < 20 || pixels.height < 20) return null;

    const reader = new MultiFormatReader();
    const hints = new Map<DecodeHintType, unknown>();
    hints.set(DecodeHintType.TRY_HARDER, true);
    hints.set(DecodeHintType.POSSIBLE_FORMATS, [
      BarcodeFormat.CODE_128,
      BarcodeFormat.CODE_39,
      BarcodeFormat.CODE_93,
      BarcodeFormat.EAN_13,
      BarcodeFormat.EAN_8,
      BarcodeFormat.ITF,
      BarcodeFormat.CODABAR,
      BarcodeFormat.QR_CODE,
      BarcodeFormat.DATA_MATRIX,
      BarcodeFormat.PDF_417,
    ]);
    reader.setHints(hints);

    // ZXing's RGBLuminanceSource expects a luminance array; we pass grayscale
    // values replicated as [r,g,b] triples per pixel.
    const { data, width, height } = pixels;
    const luminances = new Uint8ClampedArray(width * height);
    luminances.set(data.subarray(0, width * height));

    const attempts: Array<{ binarizer: 'hybrid' | 'global'; rotation: number }> = [
      { binarizer: 'hybrid', rotation: 0 },
      { binarizer: 'global', rotation: 0 },
    ];

    for (const attempt of attempts) {
      try {
        const luminanceSource = new RGBLuminanceSource(
          invertIfNeeded(luminances, attempt.binarizer),
          width,
          height
        );
        const binarizer =
          attempt.binarizer === 'hybrid'
            ? new HybridBinarizer(luminanceSource)
            : new GlobalHistogramBinarizer(luminanceSource);
        const bitmap = new BinaryBitmap(binarizer);
        const result = reader.decode(bitmap, hints);
        if (result) {
          return toBarcodeResult(result);
        }
      } catch (err) {
        if (!(err instanceof NotFoundException)) {
          // keep trying other strategies
        }
      }
    }
    return null;
  }

  /**
   * Decode from image bytes, retrying at increasing scales.
   *
   * A disc photographed at phone resolution (~400px) is below the size at which
   * ZXing can resolve PDF417 module widths, and it fails with no error. Scaling
   * up first is what makes these decodable, so each attempt is tried against the
   * ORIGINAL bytes rather than an already-downscaled raster.
   */
  async decodeImage(source: Buffer): Promise<BarcodeResult | null> {
    const metadata = await sharp(source).metadata();
    const width = metadata.width ?? 0;
    if (width < 20) return this.decode(null);

    // Cap the working size so a large scan cannot blow up memory; a disc
    // barcode is legible well below this.
    const scales = [1, 2, 3].map((s) => Math.min(Math.round(width * s), 3000));
    for (const targetWidth of [...new Set(scales)]) {
      const { data, info } = await sharp(source)
        .resize({ width: targetWidth, kernel: 'cubic', withoutEnlargement: false })
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const result = await this.decode({ data, width: info.width, height: info.height });
      if (result) return result;
    }
    return null;
  }
}

function invertIfNeeded(luminances: Uint8ClampedArray, _strategy: string): Int32Array {
  // RGBLuminanceSource takes Int32Array of RGB pixels; convert luminance -> RGB.
  const rgb = new Int32Array(luminances.length);
  for (let i = 0; i < luminances.length; i++) {
    const v = luminances[i]!;
    rgb[i] = (v << 16) | (v << 8) | v;
  }
  return rgb;
}

function toBarcodeResult(result: Result): BarcodeResult {
  const text = result.getText() ?? '';
  let confidence = 0.85; // ZXing gives no confidence; presence of clean decode is strong signal
  const resultPoints = result.getResultPoints() ?? [];
  const validPoints = resultPoints.filter((p: ResultPoint | null) => p !== null).length;
  if (validPoints > 0) confidence = Math.min(0.95, 0.8 + validPoints * 0.05);
  return {
    rawValue: text,
    symbology: result.getBarcodeFormat()?.toString() ?? 'UNKNOWN',
    confidence,
    decodedAt: new Date().toISOString(),
  };
}

/**
 * Provider factory. Keeps provider selection in one place so another
 * open-source decoder can be swapped in later without touching callers.
 */
export function getBarcodeProvider(): BarcodeProvider {
  return new ZxingBarcodeProvider();
}
