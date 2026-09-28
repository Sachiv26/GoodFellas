/**
 * Private document storage abstraction.
 * - Development: local private directory (never /public)
 * - Production: Vercel Blob private store, or an S3-compatible private bucket
 *
 * Documents must NEVER have public URLs. Blobs are written with
 * `access: 'private'` so the store URL alone is not enough to read a file;
 * reads always go through `get()` inside the authenticated download routes.
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
  const { provider: name } = appConfig.storage;
  if (name === 'blob') {
    // Fail loudly rather than falling back to the local filesystem: on Vercel
    // the filesystem is read-only and ephemeral, so a silent fallback would
    // appear to "work" on write and then lose every file on the next deploy.
    if (!appConfig.storage.blobToken) {
      throw new Error('BLOB_READ_WRITE_TOKEN is required when STORAGE_PROVIDER=blob');
    }
    // Lazy import keeps the Blob client out of the local-dev bundle.
    const mod = require('./blob') as typeof import('./blob');
    provider = new mod.BlobStorageProvider(appConfig.storage.blobToken);
  } else if (name === 's3' && appConfig.storage.bucket) {
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
