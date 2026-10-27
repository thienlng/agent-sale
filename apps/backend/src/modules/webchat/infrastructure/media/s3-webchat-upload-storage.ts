import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { WebchatUploadStorage } from '../../application/ports/upload-storage.js';
import { WebchatStorageUnavailableError } from '../../domain/webchat.errors.js';

/** S3-compatible bucket with a public base URL; never falls back to host disk. */
export class S3WebchatUploadStorage implements WebchatUploadStorage {
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

  available(): boolean {
    return this.#client !== null;
  }

  publicPrefix(): string | null {
    return this.#client && this.options.publicUrl
      ? this.options.publicUrl.replace(/\/$/, '')
      : null;
  }

  async put(key: string, bytes: Uint8Array, mime: string): Promise<string> {
    const prefix = this.publicPrefix();
    if (!this.#client || !prefix) throw new WebchatStorageUnavailableError();
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
      return `${prefix}/${key}`;
    } catch {
      throw new WebchatStorageUnavailableError();
    }
  }
}
