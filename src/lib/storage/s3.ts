import * as crypto from 'crypto';
import { assertSafeStorageKey, type StorageProvider, type StoredObject } from './index';

/**
 * S3-compatible provider implemented with fetch + SigV4 signing so the AWS SDK
 * stays an optional dependency. Compatible with AWS S3, MinIO, Cloudflare R2
 * (with endpoint) and most S3-compatible object stores.
 */
export class S3StorageProvider implements StorageProvider {
  constructor(
    private bucket: string,
    private region: string,
    private accessKey: string,
    private secretKey: string,
    private endpoint?: string
  ) {}

  private url(key: string): string {
    if (!this.endpoint) {
      return `https://${this.bucket}.s3.${this.region}.amazonaws.com/${key}`;
    }
    const base = this.endpoint.replace(/\/+$/, '');
    // Custom endpoints (MinIO, Cloudflare R2, LocalStack) are normally
    // path-style, where the bucket is a path segment — not a sub-domain. Only
    // skip the bucket segment when the endpoint already carries it.
    try {
      const parsed = new URL(base);
      if (parsed.host.startsWith(`${this.bucket}.`)) return `${base}/${key}`;
      if (parsed.pathname.replace(/\/+$/, '').endsWith(`/${this.bucket}`)) return `${base}/${key}`;
    } catch {
      // Malformed endpoint: fall through to path-style rather than silently
      // targeting the wrong object.
    }
    return `${base}/${this.bucket}/${key}`;
  }

  private async signedFetch(
    method: string,
    key: string,
    body?: Buffer,
    contentType?: string
  ): Promise<Response> {
    assertSafeStorageKey(key);
    const url = new URL(this.url(key));
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const payloadHash = crypto
      .createHash('sha256')
      .update(body ?? Buffer.alloc(0))
      .digest('hex');

    const headers: Record<string, string> = {
      host: url.host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
    };
    if (contentType) headers['content-type'] = contentType;

    const signedHeaderKeys = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderKeys.map((h) => `${h}:${headers[h]}\n`).join('');
    const signedHeaders = signedHeaderKeys.join(';');
    const canonicalRequest = [
      method,
      url.pathname,
      '',
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const scope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      scope,
      crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const hmac = (k: crypto.BinaryLike, d: string) =>
      crypto.createHmac('sha256', k).update(d).digest();
    const kDate = hmac(`AWS4${this.secretKey}`, dateStamp);
    const kRegion = hmac(kDate, this.region);
    const kService = hmac(kRegion, 's3');
    const kSigning = hmac(kService, 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    headers.authorization = `AWS4-HMAC-SHA256 Credential=${this.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(url, {
      method,
      headers,
      body: body as unknown as BodyInit,
    });
  }

  async put(key: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const res = await this.signedFetch('PUT', key, data, contentType);
    if (!res.ok) throw new Error(`S3 put failed: ${res.status}`);
    return {
      storageKey: key,
      checksum: crypto.createHash('sha256').update(data).digest('hex'),
      size: data.length,
    };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.signedFetch('GET', key);
    if (!res.ok) throw new Error(`S3 get failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.signedFetch('DELETE', key);
    if (!res.ok && res.status !== 404) throw new Error(`S3 delete failed: ${res.status}`);
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.signedFetch('HEAD', key);
    return res.ok;
  }
}
