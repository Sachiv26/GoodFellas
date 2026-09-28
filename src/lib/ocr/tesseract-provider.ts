import { createWorker, type Worker } from 'tesseract.js';
import { appConfig } from '@/lib/config';
import type { OcrProvider, OcrResult, OcrWord } from './index';

/**
 * Tesseract.js provider. Language data is cached in TESSERACT_CACHE_DIR to
 * avoid repeated downloads; recognition runs inside the job pipeline, never
 * in the upload request.
 */
export class TesseractOcrProvider implements OcrProvider {
  readonly name = 'tesseract';
  private workerPromise: Promise<Worker> | null = null;
  private lang: string;

  constructor(lang = appConfig.ocr.lang) {
    this.lang = lang;
  }

  private async getWorker(): Promise<Worker> {
    if (!this.workerPromise) {
      this.workerPromise = createWorker(this.lang, 1, {
        cachePath: appConfig.ocr.cacheDir,
        logger: () => {
          /* quiet */
        },
      });
    }
    return this.workerPromise;
  }

  async recognize(buffer: Buffer): Promise<OcrResult> {
    const worker = await this.getWorker();
    const { data } = await worker.recognize(buffer);
    const words: OcrWord[] = (data.words ?? []).map((w) => {
      const bbox = w.bbox ?? { x0: 0, y0: 0, x1: 0, y1: 0 };
      return {
        text: w.text ?? '',
        confidence: typeof w.confidence === 'number' ? w.confidence / 100 : 0,
        bbox: { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 },
        line: 0,
      };
    });
    return {
      text: data.text ?? '',
      confidence:
        typeof data.confidence === 'number' ? data.confidence / 100 : averageConfidence(words),
      words,
      engine: this.name,
    };
  }

  async terminate(): Promise<void> {
    if (this.workerPromise) {
      const worker = await this.workerPromise;
      await worker.terminate();
      this.workerPromise = null;
    }
  }
}

function averageConfidence(words: OcrWord[]): number {
  if (words.length === 0) return 0;
  const sum = words.reduce((acc, w) => acc + w.confidence, 0);
  return sum / words.length;
}
