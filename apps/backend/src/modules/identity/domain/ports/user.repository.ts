import type { UserId } from '@agent-sales/shared';

import type { User } from '../user.js';

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: UserId): Promise<User | null>;
  /** Throws EmailTakenError when the email already exists (race-safe via unique index). */
  insert(user: User): Promise<void>;
  /** Users by id, in no particular order (unknown ids are skipped). */
  findByIds(ids: readonly UserId[]): Promise<User[]>;
  /**
   * Platform admin lookup: users whose email, phone or name contains `q` (case-insensitive),
   * newest first.
   */
  search(q: string, limit: number): Promise<User[]>;
  /** Replaces the password hash; the email counts as verified (the code proved it). */
  setPassword(id: UserId, passwordHash: string, at: Date): Promise<void>;
  /**
   * Marks the email verified by an identity provider. `dropPassword` clears a password set before
   * the address was proven, so whoever registered someone else's address cannot keep access.
   */
  confirmEmail(id: UserId, at: Date, dropPassword: boolean): Promise<void>;
  /** Grants or revokes platform admin (CLI only). False when no user has that email. */
  setPlatformAdmin(email: string, value: boolean): Promise<boolean>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
