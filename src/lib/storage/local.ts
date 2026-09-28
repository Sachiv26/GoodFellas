import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { assertSafeStorageKey, type StorageProvider, type StoredObject } from './index';

export class LocalStorageProvider implements StorageProvider {
  constructor(private root: string) {}

  private resolve(key: string): string {
    assertSafeStorageKey(key);
    const full = path.resolve(this.root, key);
    const rootResolved = path.resolve(this.root);
    if (!full.startsWith(rootResolved + path.sep) && full !== rootResolved) {
      throw new Error('Invalid storage key');
    }
    return full;
  }

  async put(key: string, data: Buffer, _contentType: string): Promise<StoredObject> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, data, { mode: 0o600 });
    return {
      storageKey: key,
      checksum: crypto.createHash('sha256').update(data).digest('hex'),
      size: data.length,
    };
  }

  async get(key: string): Promise<Buffer> {
    const full = this.resolve(key);
    return fs.readFile(full);
  }

  async delete(key: string): Promise<void> {
    const full = this.resolve(key);
    await fs.rm(full, { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }
}
