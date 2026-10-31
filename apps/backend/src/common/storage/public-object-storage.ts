import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { MediaStorageUnavailableError } from './storage.errors.js';

/** Port for a public-read object store: put returns the public URL. */
export interface PublicObjectStorage {
  put(key: string, content: Uint8Array, mimeType: string): Promise<string>;
  remove(key: string): Promise<void>;
  /** True when `url` is a public URL of an object whose key starts with `keyPrefix`. */
  isPublicUrlUnder(url: string, keyPrefix: string): boolean;
}

/** Generic S3-compatible public-read bucket; never falls back to host disk. */
export class S3PublicObjectStorage implements PublicObjectStorage {
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

  isPublicUrlUnder(url: string, keyPrefix: string): boolean {
    const base = this.options.publicUrl;
    if (!this.#client || !base) return false;
    return url.startsWith(`${base.replace(/\/$/, '')}/${keyPrefix}`);
  }

  async remove(key: string): Promise<void> {
    if (!this.#client) return;
    await this.#client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
}
