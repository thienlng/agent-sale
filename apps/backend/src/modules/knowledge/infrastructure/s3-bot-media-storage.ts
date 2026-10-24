import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { BotMediaStorage } from '../application/ports/bot-media-storage.js';
import { MediaStorageUnavailableError } from '../domain/image-upload.js';

/** Generic S3-compatible public marketing-image bucket; never falls back to host disk. */
export class S3BotMediaStorage implements BotMediaStorage {
  readonly #client: S3Client | null;

  constructor(
    private readonly options: {
      endpoint?: string | undefined;
      bucket?: string | undefined;
      publicUrl?: string | undefined;
      accessKey?: string | undefined;
      secretKey?: string | undefined;
    },
  ) {
    this.#client =
      options.endpoint &&
      options.bucket &&
      options.publicUrl &&
      options.accessKey &&
      options.secretKey
        ? new S3Client({
            endpoint: options.endpoint,
            region: 'us-east-1',
            forcePathStyle: true,
            credentials: { accessKeyId: options.accessKey, secretAccessKey: options.secretKey },
            maxAttempts: 1,
            requestHandler: { requestTimeout: 15_000 },
          })
        : null;
  }

  async put(key: string, bytes: Uint8Array, mime: string): Promise<string> {
    if (!this.#client || !this.options.publicUrl) throw new MediaStorageUnavailableError();
    try {
      await this.#client.send(
        new PutObjectCommand({
          Bucket: this.options.bucket,
          Key: key,
          Body: bytes,
          ContentType: mime,
          ContentLength: bytes.byteLength,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${this.options.publicUrl.replace(/\/$/, '')}/${key}`;
    } catch {
      throw new MediaStorageUnavailableError();
    }
  }

  async remove(key: string): Promise<void> {
    if (!this.#client) return;
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}
