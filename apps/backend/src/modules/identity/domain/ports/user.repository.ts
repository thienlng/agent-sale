import type { UserId } from '@agent-sales/shared';

import type { User } from '../user.js';

export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: UserId): Promise<User | null>;
  /** Throws EmailTakenError when the email already exists (race-safe via unique index). */
  insert(user: User): Promise<void>;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');
