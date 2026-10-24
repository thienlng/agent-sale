import type { UserId } from '@agent-sales/shared';

import { EmailTakenError } from '../../domain/identity.errors.js';
import type { MfaRecord, MfaRepository } from '../../domain/ports/mfa.repository.js';
import type { SessionRecord, SessionRepository } from '../../domain/ports/session.repository.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import { User } from '../../domain/user.js';

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

  async setPlatformAdmin(email: string, value: boolean): Promise<boolean> {
    const user = await this.findByEmail(email);
    if (!user) return false;
    this.#byId.set(user.id, User.rehydrate({ ...user.snapshot(), isPlatformAdmin: value }));
    return true;
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

export class InMemoryMfaRepository implements MfaRepository {
  readonly rows = new Map<string, MfaRecord>();

  async find(userId: UserId): Promise<MfaRecord | null> {
    return this.rows.get(userId) ?? null;
  }

  async savePending(userId: UserId, secretSealed: string): Promise<boolean> {
    if (this.rows.get(userId)?.enabledAt) return false;
    this.rows.set(userId, {
      userId,
      secretSealed,
      enabledAt: null,
      lastUsedStep: 0,
      recoveryHashes: [],
    });
    return true;
  }

  async enable(userId: UserId, step: number, recoveryHashes: string[]): Promise<boolean> {
    const row = this.rows.get(userId);
    if (!row || row.enabledAt) return false;
    this.rows.set(userId, { ...row, enabledAt: new Date(), lastUsedStep: step, recoveryHashes });
    return true;
  }

  async advanceStep(userId: UserId, step: number): Promise<boolean> {
    const row = this.rows.get(userId);
    if (!row || row.lastUsedStep >= step) return false;
    row.lastUsedStep = step;
    return true;
  }

  async consumeRecovery(userId: UserId, hash: string): Promise<boolean> {
    const row = this.rows.get(userId);
    if (!row?.enabledAt || !row.recoveryHashes.includes(hash)) return false;
    row.recoveryHashes = row.recoveryHashes.filter((h) => h !== hash);
    return true;
  }

  async replaceRecovery(userId: UserId, hashes: string[]): Promise<void> {
    const row = this.rows.get(userId);
    if (row) row.recoveryHashes = hashes;
  }

  async remove(userId: UserId): Promise<boolean> {
    return this.rows.delete(userId);
  }
}
