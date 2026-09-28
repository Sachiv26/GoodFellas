/**
 * Local filesystem storage adapter (dev).
 *
 * Stores originals into `storage/private/` with randomised names.
 * No public URLs are generated for these files.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { StorageAdapter, StorageFile, StorageWriteOptions } from './types';
import { config } from '@/lib/config';
import { existsSync, mkdirSync } from 'node:fs';

export class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(config.appDir, 'storage', 'private');
    if (!existsSync(this.baseDir)) {
      mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private buildPath(documentId: string, fileName: string): string {
    const hash = crypto.createHash('sha256').update(fileName + documentId).digest('hex').slice(0, 16);
    const sub = hash.slice(0, 2);
    return path.join(this.baseDir, sub, hash + '-' + fileName);
  }

  async writeFile(
    documentId: string,
    fileName: string,
    stream: NodeJS.ReadableStream | Buffer,
    options?: StorageWriteOptions
  ): Promise<StorageFile> {
    const targetPath = this.buildPath(documentId, fileName);

    // Ensure sub directory exists
    const dir = path.dirname(targetPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const writeStream = fs.createWriteStream(targetPath);
    if (stream instanceof Buffer) {
      writeStream.write(stream, () => writeStream.end());
    } else {
      await new Promise<void>((resolve, reject) => {
        stream.pipe(writeStream);
        stream.on('end', resolve);
        stream.on('error', reject);
        writeStream.on('error', reject);
      });
    }

    const stat = await fs.promises.stat(targetPath);
    return {
      storageKey: targetPath,
      fileName: fileName,
      mimeType: options?.mimeType ?? 'application/octet-stream',
      size: stat.size,
      uploadedAt: new Date(),
      storageProvider: 'local',
    };
  }

  async readFile(storageKey: string): Promise<Buffer> {
    const data = await fs.promises.readFile(storageKey);
    return data;
  }

  async deleteFile(storageKey: string): Promise<void> {
    try {
      await fs.promises.unlink(storageKey);
    } finally {
      // Try to prune empty directories (optional)
    }
  }

  getSignedUrl(_storageKey: string, _options?: { expiresIn?: number }): string | null {
    // Local dev: serve via a separate authenticated route, never expose directly.
    return null;
  }

  async exists(storageKey: string): Promise<boolean> {
    return existsSync(storageKey);
  }
}
