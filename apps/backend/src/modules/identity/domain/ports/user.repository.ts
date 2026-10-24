import type { UserId } from '@agent-sales/shared';

import type { User } from '../user.js';

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: UserId): Promise<User | null>;
  /** Throws EmailTakenError when the email already exists (race-safe via unique index). */
  insert(user: User): Promise<void>;
  /** Grants or revokes platform admin (CLI only). False when no user has that email. */
  setPlatformAdmin(email: string, value: boolean): Promise<boolean>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
