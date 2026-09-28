/**
 * Storage adapter interface + factory.
 */
import type { S3StorageAdapter } from './s3';
import type { LocalStorageAdapter } from './local';

export interface StorageFile {
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: Date;
  storageProvider: 'local' | 's3';
}

export interface StorageWriteOptions {
  mimeType?: string;
  subFolder?: string;
}

export interface StorageAdapter {
  writeFile(
    documentId: string,
    fileName: string,
    stream: NodeJS.ReadableStream | Buffer,
    options?: StorageWriteOptions
  ): Promise<StorageFile>;
  readFile(storageKey: string): Promise<Buffer>;
  deleteFile(storageKey: string): Promise<void>;
  getSignedUrl(storageKey: string, options?: { expiresIn?: number }): string | null;
  exists(storageKey: string): Promise<boolean>;
}

export function createStorageAdapter() {
  if (process.env.STORAGE_PROVIDER === 's3') {
    return new S3StorageAdapter();
  }
  return new LocalStorageAdapter();
}
