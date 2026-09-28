/**
 * OCR engine interface + Tesseract.js wrapper.
 *
 * Architecture isolates the extraction provider so another OCR engine can be
 * swapped in later. Tesseract is the primary free/open-source engine.
 */
import type { BarcodeDecodedData } from '@/lib/barcode';

export interface OcrResult {
  text: string;
  /** Lines extracted from the OCR output with their bounding boxes. */
  lines: Array<{
    text: string;
    confidence: number;
    bbox?: { x0: number; y0: number; x1: number; y1: number };
  }>;
}

export interface OcrEngine {
  /**
   * Run OCR on an image buffer. Returns extracted text plus per-line metadata.
   */
  ocr(imageBuffer: Buffer, language?: string): Promise<OcrResult>;

  /**
   * Preprocess the image before OCR (grayscale, threshold, deskew, etc.)
   */
  preprocess?(imageBuffer: Buffer): Promise<Buffer>;
}

export class TesseractOcrEngine implements OcrEngine {
  private languages: string[];

  constructor(languages: string[] = ['eng', 'afr']) {
    this.languages = languages;
  }

  async ocr(imageBuffer: Buffer, language?: string): Promise<OcrResult> {
    const { createWorker } = await import('tesseract.js');
    const lang = language ?? this.languages.join('+');

    const worker = await createWorker(lang, 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          // progress logging can be added here
        }
      },
    });

    try {
      const { data } = await worker.recognize(imageBuffer);
      const lines = (data.lines ?? [])
        .flatMap((line) => {
          const text = (line.text ?? '').trim();
          if (!text) return [];
          return line.words.map((word) => ({
            text: word.text,
            confidence: word.confidence ?? 0,
            bbox: word.bbox
              ? {
                  x0: word.bbox.x0,
                  y0: word.bbox.y0,
                  x1: word.bbox.x1,
                  y1: word.bbox.y1,
                }
              : undefined,
          }));
        })
        .filter((w) => w.text.length > 0);

      return {
        text: data.text,
        lines,
      };
    } finally {
      await worker.terminate();
    }
  }
}

/**
 * Dummy OCR engine for testing / development when Tesseract native deps are
 * unavailable. Returns synthetic text so the extraction pipeline can still
 * exercise its logic.
 */
export class DummyOcrEngine implements OcrEngine {
  async ocr(_imageBuffer: Buffer, _language?: string): Promise<OcrResult> {
    return {
      text: 'SAMPLE OCR TEXT FOR DEVELOPMENT',
      lines: [
        {
          text: 'SAMPLE OCR TEXT FOR DEVELOPMENT',
          confidence: 0.5,
          bbox: { x0: 0, y0: 0, x1: 200, y1: 20 },
        },
      ],
    };
  }
}

export function createOcrEngine(engine: 'tesseract' | 'dummy' = 'tesseract'): OcrEngine {
  if (engine === 'dummy') return new DummyOcrEngine();
  return new TesseractOcrEngine();
}
