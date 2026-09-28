import { appConfig } from '@/lib/config';

export interface OcrWord { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number }; line: number; }
export interface OcrResult { text: string; confidence: number; words: OcrWord[]; engine: string; }
export interface OcrProvider { readonly name: string; recognize(buffer: Buffer, options?: { lang?: string }): Promise<OcrResult>; }
let cachedProvider: OcrProvider | null = null;

export function getOcrProvider(): OcrProvider {
  if (cachedProvider) return cachedProvider;
  switch (appConfig.ocr.engine) {
    case 'cohere': {
      const mod = require('./cohere-provider') as typeof import('./cohere-provider');
      cachedProvider = new mod.CohereOcrProvider();
      return cachedProvider;
    }
    case 'gemini': {
      const mod = require('./gemini-provider') as typeof import('./gemini-provider');
      cachedProvider = new mod.GeminiOcrProvider();
      return cachedProvider;
    }
    case 'tesseract':
    default: {
      const mod = require('./tesseract-provider') as typeof import('./tesseract-provider');
      cachedProvider = new mod.TesseractOcrProvider();
      return cachedProvider;
    }
  }
}