import type { UserId } from '@agent-sales/shared';

export type IdentityProvider = 'google';

export interface ExternalIdentity {
  provider: IdentityProvider;
  /** The provider's stable account id (`sub`), never the email. */
  subject: string;
  userId: UserId;
  email: string;
}

/** A link as the user sees it in account security. */
export interface LinkedIdentity extends ExternalIdentity {
  createdAt: Date;
  lastLoginAt: Date;
}

/** Provider accounts linked to users (global table `user_identities`, app_system only). */
export interface ExternalIdentityRepository {
  findUserId(provider: IdentityProvider, subject: string): Promise<UserId | null>;
  /**
   * Links the provider account to the user, or records a new sign-in of an existing link (address
   * and time). A subject already linked to another user is left untouched.
   */
  link(identity: ExternalIdentity, at: Date): Promise<void>;
  /** The user's links, oldest first. */
  listForUser(userId: UserId): Promise<LinkedIdentity[]>;
  /** Removes one link of the user; false when the user has no such link. */
  unlink(userId: UserId, provider: IdentityProvider, subject: string): Promise<boolean>;
  /** Removes every link of the user (password reset); returns how many were removed. */
  unlinkAll(userId: UserId): Promise<number>;
}

export const EXTERNAL_IDENTITY_REPOSITORY = Symbol('EXTERNAL_IDENTITY_REPOSITORY');
