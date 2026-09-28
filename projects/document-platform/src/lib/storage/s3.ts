/**
 * S3-compatible storage adapter (production).
 *
 * Only stores to a private bucket; export via signed URLs.
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageAdapter, StorageFile, StorageWriteOptions } from './types';
import { config } from '@/lib/config';

export class S3StorageAdapter implements StorageAdapter {
  private s3Client: S3Client;

  constructor() {
    this.s3Client = new S3Client({
      endpoint: config.storageEndpoint || undefined,
      region: config.storageRegion,
      credentials: config.storageAccessKey && config.storageSecretKey
        ? {
            accessKeyId: config.storageAccessKey,
            secretAccessKey: config.storageSecretKey,
          }
        : undefined,
      forcePathStyle: !!config.storageEndpoint,
    });
  }

  async writeFile(
    documentId: string,
    fileName: string,
    stream: NodeJS.ReadableStream | Buffer,
    options?: StorageWriteOptions
  ): Promise<StorageFile> {
    const key = [
      documentId,
      options?.subFolder ?? 'uploads',
      fileName.replace(/[^a-zA-Z0-9._-]/g, '_'),
    ].join('/');

    const body = stream instanceof Buffer ? stream : await streamToBuffer(stream);

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: config.storageBucket,
        Key: key,
        Body: body,
        ContentType: options?.mimeType ?? 'application/octet-stream',
      })
    );

    const head = await this.s3Client.send(new HeadObjectCommand({ Bucket: config.storageBucket, Key: key }));
    return {
      storageKey: key,
      fileName,
      mimeType: (options?.mimeType ?? head.ContentType ?? 'application/octet-stream') as string,
      size: head.ContentLength ?? 0,
      uploadedAt: new Date(),
      storageProvider: 's3',
    };
  }

  async readFile(storageKey: string): Promise<Buffer> {
    const { Body } = await this.s3Client.send(
      new GetObjectCommand({ Bucket: config.storageBucket, Key: storageKey })
    );
    if (!Body) throw new Error('Empty body');
    if (Body instanceof Buffer) return Body;
    const chunks: Buffer[] = [];
    for await (const chunk of Body as AsyncIterable<Buffer>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async deleteFile(storageKey: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({ Bucket: config.storageBucket, Key: storageKey })
    );
  }

  getSignedUrl(storageKey: string, options?: { expiresIn?: number }): string | null {
    const expiresIn = options?.expiresIn ?? 600;
    try {
      return getSignedUrl(
        this.s3Client,
        new GetObjectCommand({ Bucket: config.storageBucket, Key: storageKey }),
        { expiresIn }
      );
    } catch {
      return null;
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({ Bucket: config.storageBucket, Key: storageKey }));
      return true;
    } catch {
      return false;
    }
  }
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}
