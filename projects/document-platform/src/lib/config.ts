/**
 * Configuration loader.
 *
 * Reads from process.env (requires databaseUrl only at startup for Prisma).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

function env(key: string, fallback?: string): string {
  const raw = process.env[key];
  if (raw !== undefined && raw !== '') return raw;
  return fallback ?? '';
}

interface Config {
  databaseUrl: string;
  jwtSecret: string;
  appUrl: string;
  storageProvider: 'local' | 's3';
  storageBucket: string;
  storageAccessKey: string;
  storageSecretKey: string;
  storageEndpoint: string;
  storageRegion: string;
  ocrEngine: 'tesseract' | 'dummy';
}

const ROOT = path.resolve(process.cwd(), 'src');
const DOTENV_PATH = path.resolve(process.cwd(), '.env');

function loadEnvFile(): void {
  if (fs.existsSync(DOTENV_PATH)) {
    for (const line of fs.readFileSync(DOTENV_PATH, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadEnvFile();

export const config: Config = {
  databaseUrl: env('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/document_platform?schema=public'),
  jwtSecret: env('JWT_SECRET', 'dev-secret-change-in-production'),
  appUrl: env('APP_URL', 'http://localhost:3000'),
  storageProvider: (env('STORAGE_PROVIDER', 'local') as 'local' | 's3') || 'local',
  storageBucket: env('STORAGE_BUCKET', 'documents'),
  storageAccessKey: env('STORAGE_ACCESS_KEY'),
  storageSecretKey: env('STORAGE_SECRET_KEY'),
  storageEndpoint: env('STORAGE_ENDPOINT'),
  storageRegion: env('STORAGE_REGION', 'us-east-1'),
  ocrEngine: (env('OCR_ENGINE', 'tesseract') as 'tesseract' | 'dummy') || 'tesseract',
};
