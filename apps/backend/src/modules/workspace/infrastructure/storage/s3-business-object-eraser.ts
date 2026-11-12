import { DeleteObjectCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { businessMediaPrefixes } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { BusinessObjectEraser } from '../../application/ports/workspace-purge.js';

/**
 * Where one business's objects live: the public media bucket (`S3_BUCKET`, prefixes from
 * `businessMediaPrefixes`) and the private exports bucket (`S3_EXPORT_BUCKET`, default
 * `<S3_BUCKET>-exports`, keys `exports/<ws>/…` written by the dataexport module).
 */
export function businessObjectPrefixes(
  ws: string,
  buckets: { media: string; exports: string },
): Array<{ bucket: string; prefix: string }> {
  return [
    ...businessMediaPrefixes(ws).map((prefix) => ({ bucket: buckets.media, prefix })),
    { bucket: buckets.exports, prefix: `exports/${ws}/` },
  ];
}

/**
 * Lists every key under each prefix and deletes it one object at a time (`DeleteObject` works on
 * every S3-compatible store; the multi-object call needs checksums some do not accept). A purge
 * that fails half-way lists what is left on its retry.
 */
export class S3BusinessObjectEraser implements BusinessObjectEraser {
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
            requestHandler: { requestTimeout: 30_000 },
          })
        : null;
  }

  available(): boolean {
    return this.#client !== null;
  }

  async erase(ws: WorkspaceId): Promise<number> {
    const client = this.#client;
    const media = this.options.mediaBucket;
    if (!client || !media) return 0;
    const exports = this.options.exportBucket || `${media}-exports`;
    let deleted = 0;
    for (const { bucket, prefix } of businessObjectPrefixes(ws, { media, exports })) {
      let token: string | undefined;
      do {
        const page = await client
          .send(
            new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
          )
          .catch((e: unknown) => {
            // A bucket that was never created (no export ever made) holds nothing to delete.
            if (e instanceof Error && e.name === 'NoSuchBucket') return null;
            throw e;
          });
        if (!page) break;
        for (const object of page.Contents ?? []) {
          if (!object.Key?.startsWith(prefix)) continue;
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }));
          deleted += 1;
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
    }
    return deleted;
  }
}
