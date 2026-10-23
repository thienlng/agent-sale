import type { UserId } from '@agent-sales/shared';

import { EmailTakenError } from '../../domain/identity.errors.js';
import type { SessionRecord, SessionRepository } from '../../domain/ports/session.repository.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import type { User } from '../../domain/user.js';

/** DB-less adapters (unit tests, quick local runs). Same semantics as the Drizzle ones. */
export class InMemoryUserRepository implements UserRepository {
  readonly #byId = new Map<string, User>();

  async findByEmail(email: string): Promise<User | null> {
    const e = email.toLowerCase();
    return [...this.#byId.values()].find((u) => u.snapshot().email === e) ?? null;
  }

  async findById(id: UserId): Promise<User | null> {
    return this.#byId.get(id) ?? null;
  }

  async insert(user: User): Promise<void> {
    if (await this.findByEmail(user.snapshot().email)) throw new EmailTakenError();
    this.#byId.set(user.id, user);
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly rows = new Map<string, SessionRecord>();

  async create(s: SessionRecord): Promise<void> {
    this.rows.set(s.id, { ...s });
  }

  async findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return [...this.rows.values()].find((s) => s.tokenHash === tokenHash) ?? null;
  }

  async markRotated(id: string, at: Date): Promise<boolean> {
    const s = this.rows.get(id);
    if (!s || s.rotatedAt || s.revokedAt) return false;
    s.rotatedAt = at;
    return true;
  }

  async revoke(id: string, at: Date): Promise<void> {
    const s = this.rows.get(id);
    if (s && !s.revokedAt) s.revokedAt = at;
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    for (const s of this.rows.values())
      if (s.familyId === familyId && !s.revokedAt) s.revokedAt = at;
  }
}
