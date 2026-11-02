import type { UserId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the identity module for other modules. */
export interface IdentityFacade {
  /** Display name of a user (snapshotted by modules that record who did what), or null. */
  displayName(userId: UserId): Promise<string | null>;
  /** Name and email of a user (member lists, invitation checks), or null. */
  profile(userId: UserId): Promise<{ name: string; email: string } | null>;
}

/** Platform admin lookups (ADR-021). Callers must already have checked the platform admin flag. */
export interface IdentityAdminFacade {
  /** Users by id (unknown ids are skipped). */
  usersByIds(ids: readonly string[]): Promise<UserRef[]>;
  /** Lookup by email, phone or name (substring, case-insensitive), newest first. */
  searchUsers(q: string, limit: number): Promise<UserRef[]>;
}

export const IDENTITY_ADMIN_FACADE = Symbol('IDENTITY_ADMIN_FACADE');

/** A user as the platform admin sees it. */
export interface UserRef {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export const IDENTITY_FACADE = Symbol('IDENTITY_FACADE');
