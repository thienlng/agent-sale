import type { UserId } from '@agent-sales/shared';

import { EmailTakenError } from '../../domain/identity.errors.js';
import type {
  EmailCodePurpose,
  EmailCodeRecord,
  EmailCodeRepository,
} from '../../domain/ports/email-code.repository.js';
import type {
  ExternalIdentity,
  ExternalIdentityRepository,
  IdentityProvider,
  LinkedIdentity,
} from '../../domain/ports/external-identity.repository.js';
import type { MfaRecord, MfaRepository } from '../../domain/ports/mfa.repository.js';
import type {
  SecurityEvent,
  SecurityEventRepository,
} from '../../domain/ports/security-event.repository.js';
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

  async findByIds(ids: readonly UserId[]): Promise<User[]> {
    return ids.map((id) => this.#byId.get(id)).filter((u): u is User => u !== undefined);
  }

  async search(q: string, limit: number): Promise<User[]> {
    const needle = q.toLowerCase();
    return [...this.#byId.values()]
      .filter((u) => {
        const s = u.snapshot();
        return [s.email, s.phone ?? '', s.name].some((v) => v.toLowerCase().includes(needle));
      })
      .slice(0, limit);
  }

  async insert(user: User): Promise<void> {
    if (await this.findByEmail(user.snapshot().email)) throw new EmailTakenError();
    this.#byId.set(user.id, user);
  }

  async confirmEmail(id: UserId, at: Date, dropPassword: boolean): Promise<void> {
    const user = this.#byId.get(id);
    if (!user) return;
    const s = user.snapshot();
    this.#byId.set(
      id,
      User.rehydrate({
        ...s,
        emailVerifiedAt: s.emailVerifiedAt ?? at,
        passwordHash: dropPassword ? '' : s.passwordHash,
      }),
    );
  }

  async setPassword(id: UserId, passwordHash: string, at: Date): Promise<void> {
    const user = this.#byId.get(id);
    if (!user) return;
    const s = user.snapshot();
    this.#byId.set(
      id,
      User.rehydrate({ ...s, passwordHash, emailVerifiedAt: s.emailVerifiedAt ?? at }),
    );
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

  async findById(id: string): Promise<SessionRecord | null> {
    const s = this.rows.get(id);
    return s ? { ...s } : null;
  }

  async markAuthenticated(
    sessionId: string,
    at: Date,
    proof: { mfa: boolean; steppedUp: boolean },
  ): Promise<void> {
    const family = this.rows.get(sessionId)?.familyId;
    for (const s of this.rows.values())
      if (family && s.familyId === family && !s.revokedAt) {
        s.authenticatedAt = at;
        if (proof.mfa) s.mfa = true;
        if (proof.steppedUp) s.steppedUpAt = at;
      }
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

  async revokeOtherFamilies(userId: UserId, keepSessionId: string, at: Date): Promise<void> {
    const keep = this.rows.get(keepSessionId)?.familyId;
    for (const s of this.rows.values())
      if (s.userId === userId && s.familyId !== keep && !s.revokedAt) s.revokedAt = at;
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

export class InMemoryEmailCodeRepository implements EmailCodeRepository {
  readonly rows = new Map<string, EmailCodeRecord>();

  async find(email: string, purpose: EmailCodePurpose): Promise<EmailCodeRecord | null> {
    const row = this.rows.get(`${email}:${purpose}`);
    return row ? { ...row } : null;
  }

  async put(record: EmailCodeRecord): Promise<void> {
    this.rows.set(`${record.email}:${record.purpose}`, { ...record });
  }

  async addAttempt(email: string, purpose: EmailCodePurpose): Promise<void> {
    const row = this.rows.get(`${email}:${purpose}`);
    if (row) row.attempts += 1;
  }

  async delete(email: string, purpose: EmailCodePurpose): Promise<void> {
    this.rows.delete(`${email}:${purpose}`);
  }
}

export class InMemoryExternalIdentityRepository implements ExternalIdentityRepository {
  readonly rows = new Map<string, LinkedIdentity>();

  async findUserId(provider: IdentityProvider, subject: string): Promise<UserId | null> {
    return this.rows.get(`${provider}:${subject}`)?.userId ?? null;
  }

  async link(identity: ExternalIdentity, at: Date): Promise<void> {
    const key = `${identity.provider}:${identity.subject}`;
    const existing = this.rows.get(key);
    if (existing && existing.userId !== identity.userId) return;
    this.rows.set(key, { ...identity, createdAt: existing?.createdAt ?? at, lastLoginAt: at });
  }

  async listForUser(userId: UserId): Promise<LinkedIdentity[]> {
    return [...this.rows.values()]
      .filter((r) => r.userId === userId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((r) => ({ ...r }));
  }

  async unlink(userId: UserId, provider: IdentityProvider, subject: string): Promise<boolean> {
    const key = `${provider}:${subject}`;
    if (this.rows.get(key)?.userId !== userId) return false;
    return this.rows.delete(key);
  }

  async unlinkAll(userId: UserId): Promise<number> {
    let removed = 0;
    for (const [key, r] of this.rows) if (r.userId === userId && this.rows.delete(key)) removed++;
    return removed;
  }
}

export class InMemorySecurityEventRepository implements SecurityEventRepository {
  readonly rows: SecurityEvent[] = [];

  async append(event: SecurityEvent): Promise<void> {
    this.rows.push({ ...event });
  }

  async listForUser(userId: UserId, limit: number): Promise<SecurityEvent[]> {
    return this.rows
      .filter((e) => e.userId === userId)
      .reverse()
      .slice(0, limit);
  }
}
