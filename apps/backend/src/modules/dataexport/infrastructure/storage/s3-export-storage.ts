import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { isMediaPath } from '@agent-sales/contracts';

import { mediaPath } from '../../../../common/storage/media-url.js';
import type { ExportFileStorage } from '../../application/ports/export-files.js';

/**
 * Exports live in their own bucket (`S3_EXPORT_BUCKET`, default `<S3_BUCKET>-exports`): the media
 * bucket is public-read for Meta, exports must never be. Media are read from `S3_BUCKET` by key.
 */
export class S3ExportFileStorage implements ExportFileStorage {
  readonly #client: S3Client | null;

  constructor(
    private readonly options: {
      endpoint?: string | undefined;
      mediaBucket?: string | undefined;
      exportBucket?: string | undefined;
      accessKey?: string | undefined;
      secretKey?: string | undefined;
    },
  ) {
    this.#client =
      options.endpoint && options.mediaBucket && options.accessKey && options.secretKey
        ? new S3Client({
            endpoint: options.endpoint,
            region: 'us-east-1',
            forcePathStyle: true,
            credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
            maxAttempts: 3,
            requestHandler: { requestTimeout: 120_000 },
          })
        : null;
  }

  get #exportBucket(): string {
    return this.options.exportBucket || `${this.options.mediaBucket}-exports`;
  }

  available(): boolean {
    return this.#client !== null;
  }

  async upload(key: string, filePath: string, sizeBytes: number): Promise<void> {
    if (!this.#client) throw new Error('export storage unavailable');
    await this.#client.send(
      new PutObjectCommand({
        Bucket: this.#exportBucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentLength: sizeBytes,
        ContentType: 'application/zip',
      }),
    );
  }

  async open(key: string): Promise<{ body: AsyncIterable<Uint8Array>; sizeBytes: number | null }> {
    if (!this.#client) throw new Error('export storage unavailable');
    const out = await this.#client.send(
      new GetObjectCommand({ Bucket: this.#exportBucket, Key: key }),
    );
    return { body: out.Body as Readable, sizeBytes: out.ContentLength ?? null };
  }

  async remove(key: string): Promise<void> {
    if (!this.#client) return;
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.#exportBucket, Key: key }));
  }

  async readMedia(url: string): Promise<{ key: string; body: AsyncIterable<Uint8Array> } | null> {
    if (!this.#client) return null;
    const key = mediaKey(url);
    if (!key) return null;
    try {
      const out = await this.#client.send(
        new GetObjectCommand({ Bucket: this.options.mediaBucket, Key: key }),
      );
      return out.Body ? { key, body: out.Body as Readable } : null;
    } catch (e) {
      if (e instanceof NoSuchKey) return null;
      throw e;
    }
  }
}

/** The bucket key of a Rapiz-stored object: from a public URL, a `/media/<key>` path or a bare key. */
export function mediaKey(url: string): string | null {
  const value = url.trim();
  const path =
    mediaPath(value) ??
    (/^[a-z0-9]/i.test(value) && isMediaPath(`/media/${value}`) ? `/media/${value}` : null);
  return path ? path.slice('/media/'.length) : null;
}
