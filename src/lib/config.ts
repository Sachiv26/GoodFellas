/**
 * Application configuration from environment variables.
 * Never import this from client components.
 */
export const appConfig = {
  jwtSecret: process.env.JWT_SECRET ?? '',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'goodfellas_session',
  appUrl: process.env.APP_URL ?? 'http://localhost:3000',
  storage: {
    provider: (process.env.STORAGE_PROVIDER ?? 'local') as 'local' | 's3' | 'blob',
    localRoot: process.env.STORAGE_LOCAL_ROOT ?? './storage/private',
    // Vercel Blob store token. Server-side only — never expose to the client.
    blobToken: process.env.BLOB_READ_WRITE_TOKEN ?? '',
    bucket: process.env.STORAGE_BUCKET ?? '',
    region: process.env.STORAGE_REGION ?? '',
    accessKey: process.env.STORAGE_ACCESS_KEY ?? '',
    secretKey: process.env.STORAGE_SECRET_KEY ?? '',
    endpoint: process.env.STORAGE_ENDPOINT ?? '',
  },
  ocr: {
    engine: (process.env.OCR_ENGINE ?? 'tesseract') as 'tesseract' | 'gemini' | 'cohere',
    cacheDir: process.env.TESSERACT_CACHE_DIR ?? './tessdata',
    lang: process.env.TESSERACT_LANG ?? 'eng',
    geminiApiKey: process.env.GEMINI_API_KEY ?? '',
    geminiModel: process.env.GEMINI_MODEL ?? 'gemini-3.6-flash',
    cohereApiKey: process.env.COHERE_API_KEY ?? '',
    cohereModel: process.env.COHERE_MODEL ?? 'command-a-vision-07-2025',
  },
  barcode: { engine: (process.env.BARCODE_ENGINE ?? 'zxing') as 'zxing' },
  payment: {
    provider: (process.env.PAYMENT_PROVIDER ?? 'ozow') as 'ozow',
    ozowMerchantId: process.env.OZOW_MERCHANT_ID ?? '',
    ozowApiKey: process.env.OZOW_API_KEY ?? '',
    ozowApiUrl: process.env.OZOW_API_URL ?? 'https://api.ozow.com/v1',
  },
  uploads: {
    maxBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),
    allowedMimeTypes: ['image/jpeg', 'image/jpg', 'image/png', 'application/pdf'] as string[],
    allowedExtensions: ['.jpg', '.jpeg', '.png', '.pdf'] as string[],
  },
} as const;

if (!appConfig.jwtSecret && process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET must be set in production');