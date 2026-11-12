import type { WorkspaceId } from '@agent-sales/shared';

/**
 * Files a website visitor uploaded to our bucket (`webchat/<workspace>/…`, the webchat upload
 * route). Customer deletion removes them; product pictures and every external URL stay.
 */
export interface CustomerMediaStorage {
  /** Removes the objects of these URLs that are uploads of this workspace's visitors; how many. */
  removeVisitorUploads(ws: WorkspaceId, urls: readonly string[]): Promise<number>;
}
export const CUSTOMER_MEDIA = Symbol('CUSTOMER_MEDIA');
