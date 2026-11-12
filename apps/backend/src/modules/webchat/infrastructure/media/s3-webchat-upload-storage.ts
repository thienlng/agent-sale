import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

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

  async promote(temporaryKey: string, key: string): Promise<string> {
    const prefix = this.publicPrefix();
    if (!this.#client || !prefix) throw new WebchatStorageUnavailableError();
    try {
      await this.#client.send(
        new CopyObjectCommand({
          Bucket: this.options.bucket,
          CopySource: `${this.options.bucket}/${temporaryKey}`,
          Key: key,
          CacheControl: 'public, max-age=31536000, immutable',
          MetadataDirective: 'COPY',
        }),
      );
      // The temporary copy is no longer needed (best effort: the purge job removes leftovers).
      await this.#client
        .send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: temporaryKey }))
        .catch(() => undefined);
      return `${prefix}/${key}`;
    } catch {
      // A retried send after the temporary copy was purged: the permanent object is enough.
      try {
        await this.#client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
        return `${prefix}/${key}`;
      } catch {
        throw new WebchatStorageUnavailableError();
      }
    }
  }

  async purge(prefix: string, before: Date): Promise<number> {
    if (!this.#client) return 0;
    let deleted = 0;
    let token: string | undefined;
    do {
      const page = await this.#client.send(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      );
      const stale = (page.Contents ?? [])
        .filter((o) => o.Key && o.LastModified && o.LastModified < before)
        .map((o) => ({ Key: o.Key as string }));
      if (stale.length > 0) {
        await this.#client.send(
          new DeleteObjectsCommand({
            Bucket: this.options.bucket,
            Delete: { Objects: stale, Quiet: true },
          }),
        );
        deleted += stale.length;
      }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return deleted;
  }
}
