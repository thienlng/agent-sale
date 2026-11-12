import type { WorkspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';

import { mediaPath } from '../../../../common/storage/media-url.js';
import type { PublicObjectStorage } from '../../../../common/storage/public-object-storage.js';
import type { CustomerMediaStorage } from '../../application/ports/customer-media.js';

const log = new Logger('CustomerMedia');

/**
 * The object key of a public URL of our bucket: after the public base, or after `/media/` for a
 * host-relative path (or that path on an older host). Null for anything else.
 */
export function objectKeyOf(url: string, publicBase: string | undefined): string | null {
  const base = publicBase?.replace(/\/$/, '');
  if (base && url.startsWith(`${base}/`)) return url.slice(base.length + 1);
  const path = mediaPath(url);
  return path?.startsWith('/media/') ? path.slice('/media/'.length) : null;
}

/** Removes website-visitor uploads (`webchat/<workspace>/…`) from the public bucket. */
export class S3CustomerMediaStorage implements CustomerMediaStorage {
  constructor(
    private readonly storage: PublicObjectStorage,
    private readonly publicBase: string | undefined,
  ) {}

  async removeVisitorUploads(ws: WorkspaceId, urls: readonly string[]): Promise<number> {
    const prefix = `webchat/${ws}/`;
    const keys = new Set<string>();
    for (const url of urls) {
      if (!this.storage.isPublicUrlUnder(url, prefix)) continue;
      const key = objectKeyOf(url, this.publicBase);
      // `isPublicUrlUnder` already refused `..`; the prefix check keeps other tenants' files out.
      if (key?.startsWith(prefix)) keys.add(key);
    }
    let removed = 0;
    for (const key of keys) {
      try {
        await this.storage.remove(key);
        removed += 1;
      } catch {
        // Keys hold only ids; the error text may echo the request, so it is not logged.
        log.warn(`Visitor upload could not be removed for workspace ${ws}`);
      }
    }
    return removed;
  }
}
