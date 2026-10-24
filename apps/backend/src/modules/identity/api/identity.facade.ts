import type { UserId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the identity module for other modules. */
export interface IdentityFacade {
  /** Display name of a user (snapshotted by modules that record who did what), or null. */
  displayName(userId: UserId): Promise<string | null>;
}

export const IDENTITY_FACADE = Symbol('IDENTITY_FACADE');
