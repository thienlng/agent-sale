import type { WorkspaceId } from '@agent-sales/shared';

/** Storage key prefix of a workspace's product pictures (see POST /products/images). */
export const ownImagePrefix = (ws: WorkspaceId): string => `products/${ws}/`;

/** The part of the storage that can say whether a URL is one of its public objects. */
export interface ImageUrlChecker {
  isPublicUrlUnder(url: string, keyPrefix: string): boolean;
}

/**
 * Pictures must be files Rapiz stored for this workspace. Returns
 * 'IMAGE_NOT_UPLOADED' for anything else (external links, another workspace,
 * unconfigured storage, traversal tricks), or null when the URL is acceptable.
 */
export function ownImageProblem(
  url: string,
  ws: WorkspaceId,
  storage: ImageUrlChecker,
): 'IMAGE_NOT_UPLOADED' | null {
  const prefix = ownImagePrefix(ws);
  if (!storage.isPublicUrlUnder(url, prefix)) return 'IMAGE_NOT_UPLOADED';
  if (/[?#%\\]|\.\./.test(url)) return 'IMAGE_NOT_UPLOADED';
  const file = url.slice(url.indexOf(`/${prefix}`) + prefix.length + 1);
  return /^[\w-]+\.(jpe?g|png|webp)$/i.test(file) ? null : 'IMAGE_NOT_UPLOADED';
}
