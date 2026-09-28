/**
 * Private document storage abstraction.
 * - Development: local private directory (never /public)
 * - Production: S3-compatible private bucket
 * Documents must NEVER have public URLs.
 */
import { appConfig } from '@/lib/config';

export interface StoredObject {
  storageKey: string;
  checksum: string;
  size: number;
}

export interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

/** Prevents path traversal: keys must be relative, normalized, no "..". */
export function assertSafeStorageKey(key: string): void {
  if (!key || key.length > 512) throw new Error('Invalid storage key');
  if (key.startsWith('/') || key.includes('..') || key.includes('\\') || key.includes('\0')) {
    throw new Error('Invalid storage key');
  }
  const normalized = key.replace(/\/+/g, '/');
  if (normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error('Invalid storage key');
  }
}

let provider: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (provider) return provider;
  if (appConfig.storage.provider === 's3' && appConfig.storage.bucket) {
    // Lazy import keeps the S3 code out of the dev bundle.
    const mod = require('./s3') as typeof import('./s3');
    provider = new mod.S3StorageProvider(
      appConfig.storage.bucket,
      appConfig.storage.region,
      appConfig.storage.accessKey,
      appConfig.storage.secretKey,
      appConfig.storage.endpoint || undefined
    );
  } else {
    const mod = require('./local') as typeof import('./local');
    provider = new mod.LocalStorageProvider(appConfig.storage.localRoot);
  }
  return provider;
}

/** Build a safe private storage key for an application document. */
export function documentStorageKey(
  applicationId: string,
  documentId: string,
  extension: string
): string {
  const safeExt = extension.replace(/[^a-z0-9]/gi, '').slice(0, 8) || 'bin';
  return `applications/${applicationId}/documents/${documentId}.${safeExt}`;
}

/** Build a safe private storage key for a generated admin PDF. */
export function generatedPdfStorageKey(applicationId: string, generatedId: string): string {
  return `applications/${applicationId}/generated/${generatedId}.pdf`;
}

/** Build a safe private storage key for a registered PDF template. */
export function templateStorageKey(templateCode: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `templates/${templateCode}/${safe}`;
}
