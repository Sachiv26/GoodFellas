import * as crypto from 'crypto';
import { BlobNotFoundError, del, get, head, put } from '@vercel/blob';
import { assertSafeStorageKey, type StorageProvider, type StoredObject } from './index';

/**
 * Vercel Blob provider (server-side only).
 *
 * All blobs are written with `access: 'private'`. A private blob is NOT
 * reachable from its URL without the store token, so uploaded identity
 * documents, proof of residence, licence discs and generated PDFs cannot be
 * fetched by anyone who merely learns the URL. Reads go through the
 * authenticated `get()` helper, and the application's existing download routes
 * keep their own auth checks in front of it.
 *
 * Key semantics deliberately mirror the local provider so the existing
 * `storageKey` values in the database stay valid:
 *   - `addRandomSuffix: false` — the pathname we store is the pathname we look
 *     up, so `get(storageKey)` resolves without extra bookkeeping.
 *   - `allowOverwrite: true` — signing a proxy PDF re-uploads to the SAME key.
 *     With random suffixes each write would create a new blob and orphan the
 *     previous one. Uniqueness is already guaranteed upstream because
 *     `documentStorageKey`/`generatedPdfStorageKey` embed a UUID.
 */
export class BlobStorageProvider implements StorageProvider {
  constructor(private token: string) {
    if (!token) throw new Error('BLOB_READ_WRITE_TOKEN is required for STORAGE_PROVIDER=blob');
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    assertSafeStorageKey(key);
    try {
      const result = await put(key, data, {
        access: 'private',
        token: this.token,
        contentType: contentType || 'application/octet-stream',
        addRandomSuffix: false,
        allowOverwrite: true,
      });
      return {
        storageKey: result.pathname,
        checksum: crypto.createHash('sha256').update(data).digest('hex'),
        size: data.length,
      };
    } catch {
      // Deliberately opaque: upstream messages can embed store details, and
      // this class is reached from routes that surface errors to customers.
      throw new Error('STORAGE_UPLOAD_FAILED');
    }
  }

  async get(key: string): Promise<Buffer> {
    assertSafeStorageKey(key);
    let result: Awaited<ReturnType<typeof get>>;
    try {
      result = await get(key, { access: 'private', token: this.token });
    } catch {
      throw new Error('STORAGE_DOWNLOAD_FAILED');
    }
    if (!result) throw new Error('STORAGE_OBJECT_NOT_FOUND');
    // Read via the standard ReadableStream reader rather than `for await`:
    // it is available in every runtime the app targets and avoids depending on
    // the stream object exposing Symbol.asyncIterator.
    const stream = result.stream as ReadableStream<Uint8Array> | null;
    if (!stream) throw new Error('STORAGE_DOWNLOAD_FAILED');
    const reader = stream.getReader();
    const chunks: Buffer[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    assertSafeStorageKey(key);
    try {
      await del(key, { token: this.token });
    } catch (error) {
      // Deleting an object that is already gone is a success from the
      // caller's point of view (replacement flows rely on this).
      if (error instanceof BlobNotFoundError) return;
      throw new Error('STORAGE_DELETE_FAILED');
    }
  }

  async exists(key: string): Promise<boolean> {
    assertSafeStorageKey(key);
    try {
      await head(key, { token: this.token });
      return true;
    } catch (error) {
      if (error instanceof BlobNotFoundError) return false;
      throw new Error('STORAGE_HEAD_FAILED');
    }
  }
}
