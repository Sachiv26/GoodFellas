import { describe, expect, it, jest } from '@jest/globals';

// Mock the Vercel Blob client so no network or real store is touched.
// Typed loosely on purpose: these stand in for the SDK's overloaded signatures.
const put = jest.fn<(...args: any[]) => any>(async () => ({ pathname: 'applications/app/documents/doc.png', url: 'https://store.example/private/doc.png', contentType: 'image/png', uploadedAt: new Date(), size: 3 }));
const get = jest.fn<(...args: any[]) => any>(async () => null);
const head = jest.fn<(...args: any[]) => any>(async () => ({ size: 3, uploadedAt: new Date(), pathname: 'applications/app/documents/doc.png' }));
const del = jest.fn<(...args: any[]) => any>(async () => undefined);

jest.mock('@vercel/blob', () => ({
  put: (...args: unknown[]) => put(...(args as [])),
  get: (...args: unknown[]) => get(...(args as [])),
  head: (...args: unknown[]) => head(...(args as [])),
  del: (...args: unknown[]) => del(...(args as [])),
  BlobNotFoundError: class BlobNotFoundError extends Error {},
}));

const { BlobStorageProvider } = require('@/lib/storage/blob') as typeof import('@/lib/storage/blob');
const { BlobNotFoundError } = require('@vercel/blob') as unknown as { BlobNotFoundError: new (m?: string) => Error };

/** A ReadableStream-like object, matching the shape the real `get()` returns. */
function streamOf(...chunks: Buffer[]) {
  let i = 0;
  return {
    getReader() {
      return {
        async read() {
          return i < chunks.length
            ? { done: false, value: chunks[i++] }
            : { done: true, value: undefined };
        },
      };
    },
  };
}

const KEY = 'applications/app/documents/doc.png';

describe('BlobStorageProvider', () => {
  it('uploads as a PRIVATE blob and returns the pathname as the storage key', async () => {
    put.mockClear();
    const provider = new BlobStorageProvider('test-token');
    const result = await provider.put(KEY, Buffer.from('abc'), 'image/png');
    expect(result.storageKey).toBe('applications/app/documents/doc.png');
    expect(result.size).toBe(3);
    // sha256 of "abc"
    expect(result.checksum).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const options = put.mock.calls[0]![2] as Record<string, unknown>;
    expect(options.access).toBe('private');
    expect(options.token).toBe('test-token');
    expect(options.contentType).toBe('image/png');
  });

  it('never makes a blob publicly readable', async () => {
    put.mockClear();
    await new BlobStorageProvider('test-token').put(KEY, Buffer.from('abc'), 'image/png');
    for (const call of put.mock.calls) {
      expect((call[2] as Record<string, unknown>).access).not.toBe('public');
    }
  });

  it('overwrites in place so re-signing does not orphan the previous blob', async () => {
    put.mockClear();
    await new BlobStorageProvider('test-token').put(KEY, Buffer.from('abc'), 'image/png');
    const options = put.mock.calls[0]![2] as Record<string, unknown>;
    expect(options.allowOverwrite).toBe(true);
    expect(options.addRandomSuffix).toBe(false);
  });

  it('reads a private blob by key', async () => {
    get.mockReset();
    get.mockImplementation(async () => ({ stream: streamOf(Buffer.from('ab'), Buffer.from('c')) }) as never);
    const out = await new BlobStorageProvider('test-token').get(KEY);
    expect(out.toString()).toBe('abc');
    expect((get.mock.calls[0]![1] as Record<string, unknown>).access).toBe('private');
  });

  it('reports a missing object distinctly from a failure', async () => {
    get.mockReset();
    get.mockImplementation(async () => null as never);
    await expect(new BlobStorageProvider('test-token').get(KEY)).rejects.toThrow('STORAGE_OBJECT_NOT_FOUND');
  });

  it('does not leak store detail in error messages', async () => {
    put.mockReset();
    put.mockImplementation(async () => {
      throw new Error('store "my-private-store" token vercel_blob_rw_XXXX rejected for path applications/app/documents/doc.png');
    });
    const error = (await new BlobStorageProvider('super-secret-token')
      .put(KEY, Buffer.from('abc'), 'image/png')
      .then(() => null, (e: Error) => e)) as Error;
    expect(error.message).toBe('STORAGE_UPLOAD_FAILED');
    expect(error.message).not.toContain('super-secret-token');
  });

  it('treats deleting an already-missing blob as success', async () => {
    del.mockReset();
    del.mockImplementation(async () => {
      throw new BlobNotFoundError('nope');
    });
    await expect(new BlobStorageProvider('test-token').delete(KEY)).resolves.toBeUndefined();
  });

  it('reports existence without throwing on a missing blob', async () => {
    head.mockReset();
    head.mockImplementation(async () => {
      throw new BlobNotFoundError('nope');
    });
    await expect(new BlobStorageProvider('test-token').exists(KEY)).resolves.toBe(false);
  });

  it('refuses path-traversal keys before touching the network', async () => {
    put.mockClear();
    get.mockClear();
    del.mockClear();
    const provider = new BlobStorageProvider('test-token');
    await expect(provider.put('../escape.png', Buffer.from('x'), 'image/png')).rejects.toThrow('Invalid storage key');
    await expect(provider.get('/absolute.png')).rejects.toThrow('Invalid storage key');
    await expect(provider.delete('a/../../b.png')).rejects.toThrow('Invalid storage key');
    expect(put).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});
