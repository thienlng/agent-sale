import {
  and,
  asc,
  type Database,
  desc,
  eq,
  inArray,
  isNull,
  schema,
  sql,
  withSystem,
} from '@agent-sales/db';
import { type UserId, userId } from '@agent-sales/shared';

import { EmailTakenError } from '../../domain/identity.errors.js';
import type {
  ExternalIdentity,
  ExternalIdentityRepository,
  IdentityProvider,
  LinkedIdentity,
} from '../../domain/ports/external-identity.repository.js';
import type {
  EmailCodePurpose,
  EmailCodeRecord,
  EmailCodeRepository,
} from '../../domain/ports/email-code.repository.js';
import type { MfaRecord, MfaRepository } from '../../domain/ports/mfa.repository.js';
import type {
  SecurityAction,
  SecurityEvent,
  SecurityEventRepository,
} from '../../domain/ports/security-event.repository.js';
import type { SessionRecord, SessionRepository } from '../../domain/ports/session.repository.js';
import type { UserRepository } from '../../domain/ports/user.repository.js';
import { User } from '../../domain/user.js';

type UserRow = typeof schema.users.$inferSelect;

function toUser(row: UserRow): User {
  return User.rehydrate({
    id: userId(row.id),
    email: row.email,
    name: row.name,
    phone: row.phone,
    passwordHash: row.passwordHash ?? '',
    emailVerifiedAt: row.emailVerifiedAt,
    locale: row.locale,
    timezone: row.timezone,
    isPlatformAdmin: row.isPlatformAdmin,
    createdAt: row.createdAt,
  });
}

/** Identity is cross-tenant: these adapters use the app_system connection (migration 0001). */
export class DrizzleUserRepository implements UserRepository {
  constructor(private readonly systemDb: Database) {}

  findByEmail(email: string): Promise<User | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.users)
        .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`)
        .limit(1);
      return row ? toUser(row) : null;
    });
  }

  findById(id: UserId): Promise<User | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx.select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
      return row ? toUser(row) : null;
    });
  }

  findByIds(ids: readonly UserId[]): Promise<User[]> {
    if (!ids.length) return Promise.resolve([]);
    return withSystem(this.systemDb, async (tx) =>
      (
        await tx
          .select()
          .from(schema.users)
          .where(inArray(schema.users.id, [...ids]))
      ).map(toUser),
    );
  }

  search(q: string, limit: number): Promise<User[]> {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const u = schema.users;
    return withSystem(this.systemDb, async (tx) =>
      (
        await tx
          .select()
          .from(u)
          .where(
            sql`${u.email} ilike ${like} or ${u.phone} ilike ${like} or ${u.name} ilike ${like}`,
          )
          .orderBy(sql`${u.createdAt} desc`)
          .limit(limit)
      ).map(toUser),
    );
  }

  async insert(user: User): Promise<void> {
    const s = user.snapshot();
    try {
      await withSystem(this.systemDb, (tx) =>
        tx.insert(schema.users).values({
          id: s.id,
          email: s.email,
          name: s.name,
          phone: s.phone,
          passwordHash: s.passwordHash || null,
          locale: s.locale,
          timezone: s.timezone,
          emailVerifiedAt: s.emailVerifiedAt,
          createdAt: s.createdAt,
        }),
      );
    } catch (e) {
      const code =
        (e as { cause?: { code?: string }; code?: string }).cause?.code ??
        (e as { code?: string }).code;
      if (code === '23505') throw new EmailTakenError();
      throw e;
    }
  }

  async setPassword(id: UserId, passwordHash: string, at: Date): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx
        .update(schema.users)
        .set({
          passwordHash,
          emailVerifiedAt: sql`coalesce(${schema.users.emailVerifiedAt}, ${at.toISOString()}::timestamptz)`,
          updatedAt: at,
        })
        .where(eq(schema.users.id, id)),
    );
  }

  async confirmEmail(id: UserId, at: Date, dropPassword: boolean): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx
        .update(schema.users)
        .set({
          emailVerifiedAt: sql`coalesce(${schema.users.emailVerifiedAt}, ${at.toISOString()}::timestamptz)`,
          ...(dropPassword ? { passwordHash: null } : {}),
          updatedAt: at,
        })
        .where(eq(schema.users.id, id)),
    );
  }

  setPlatformAdmin(email: string, value: boolean): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .update(schema.users)
        .set({ isPlatformAdmin: value, updatedAt: new Date() })
        .where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`)
        .returning({ id: schema.users.id });
      return rows.length === 1;
    });
  }
}

export class DrizzleExternalIdentityRepository implements ExternalIdentityRepository {
  constructor(private readonly systemDb: Database) {}

  findUserId(provider: IdentityProvider, subject: string): Promise<UserId | null> {
    const t = schema.userIdentities;
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx
        .select({ userId: t.userId })
        .from(t)
        .where(and(eq(t.provider, provider), eq(t.subject, subject)))
        .limit(1);
      return row ? userId(row.userId) : null;
    });
  }

  async link(identity: ExternalIdentity, at: Date): Promise<void> {
    const t = schema.userIdentities;
    await withSystem(this.systemDb, (tx) =>
      tx
        .insert(t)
        .values({ ...identity, createdAt: at, lastLoginAt: at })
        .onConflictDoUpdate({
          target: [t.provider, t.subject],
          set: { email: identity.email, lastLoginAt: at },
          setWhere: eq(t.userId, identity.userId),
        }),
    );
  }

  listForUser(id: UserId): Promise<LinkedIdentity[]> {
    const t = schema.userIdentities;
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx.select().from(t).where(eq(t.userId, id)).orderBy(asc(t.createdAt));
      return rows.map((r) => ({ ...r, userId: userId(r.userId) }));
    });
  }

  unlink(id: UserId, provider: IdentityProvider, subject: string): Promise<boolean> {
    const t = schema.userIdentities;
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .delete(t)
        .where(and(eq(t.userId, id), eq(t.provider, provider), eq(t.subject, subject)))
        .returning({ subject: t.subject });
      return rows.length === 1;
    });
  }

  unlinkAll(id: UserId): Promise<number> {
    const t = schema.userIdentities;
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx.delete(t).where(eq(t.userId, id)).returning({ subject: t.subject });
      return rows.length;
    });
  }
}

export class DrizzleSecurityEventRepository implements SecurityEventRepository {
  constructor(private readonly systemDb: Database) {}

  async append(e: SecurityEvent): Promise<void> {
    await withSystem(this.systemDb, (tx) => tx.insert(schema.userSecurityEvents).values({ ...e }));
  }

  listForUser(id: UserId, limit: number): Promise<SecurityEvent[]> {
    const t = schema.userSecurityEvents;
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select()
        .from(t)
        .where(eq(t.userId, id))
        .orderBy(desc(t.createdAt), desc(t.id))
        .limit(limit);
      return rows.map((r) => ({
        ...r,
        userId: userId(r.userId),
        action: r.action as SecurityAction,
      }));
    });
  }
}

export class DrizzleSessionRepository implements SessionRepository {
  constructor(private readonly systemDb: Database) {}

  async create(s: SessionRecord): Promise<void> {
    await withSystem(this.systemDb, (tx) => tx.insert(schema.sessions).values({ ...s }));
  }

  findByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.tokenHash, tokenHash))
        .limit(1);
      return row ? { ...row, userId: userId(row.userId) } : null;
    });
  }

  findById(id: string): Promise<SessionRecord | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .limit(1);
      return row ? { ...row, userId: userId(row.userId) } : null;
    });
  }

  async markAuthenticated(sessionId: string, at: Date, mfa: boolean): Promise<void> {
    await withSystem(this.systemDb, (tx) => {
      const family = tx
        .select({ familyId: schema.sessions.familyId })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId));
      return tx
        .update(schema.sessions)
        .set({ authenticatedAt: at, ...(mfa ? { mfa: true } : {}) })
        .where(
          and(isNull(schema.sessions.revokedAt), sql`${schema.sessions.familyId} = (${family})`),
        );
    });
  }

  markRotated(id: string, at: Date): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .update(schema.sessions)
        .set({ rotatedAt: at })
        .where(
          and(
            eq(schema.sessions.id, id),
            isNull(schema.sessions.rotatedAt),
            isNull(schema.sessions.revokedAt),
          ),
        )
        .returning({ id: schema.sessions.id });
      return rows.length === 1;
    });
  }

  async revoke(id: string, at: Date): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx.update(schema.sessions).set({ revokedAt: at }).where(eq(schema.sessions.id, id)),
    );
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx
        .update(schema.sessions)
        .set({ revokedAt: at })
        .where(and(eq(schema.sessions.familyId, familyId), isNull(schema.sessions.revokedAt))),
    );
  }

  async revokeOtherFamilies(userId: UserId, keepSessionId: string, at: Date): Promise<void> {
    await withSystem(this.systemDb, (tx) => {
      const keep = tx
        .select({ familyId: schema.sessions.familyId })
        .from(schema.sessions)
        .where(eq(schema.sessions.id, keepSessionId));
      return tx
        .update(schema.sessions)
        .set({ revokedAt: at })
        .where(
          and(
            eq(schema.sessions.userId, userId),
            isNull(schema.sessions.revokedAt),
            sql`${schema.sessions.familyId} is distinct from (${keep})`,
          ),
        );
    });
  }
}

export class DrizzleMfaRepository implements MfaRepository {
  constructor(private readonly systemDb: Database) {}

  find(id: UserId): Promise<MfaRecord | null> {
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx
        .select()
        .from(schema.userMfa)
        .where(eq(schema.userMfa.userId, id))
        .limit(1);
      return row ? { ...row, userId: userId(row.userId) } : null;
    });
  }

  savePending(id: UserId, secretSealed: string): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .insert(schema.userMfa)
        .values({ userId: id, secretSealed })
        .onConflictDoUpdate({
          target: schema.userMfa.userId,
          set: { secretSealed, lastUsedStep: 0, recoveryHashes: [] },
          setWhere: isNull(schema.userMfa.enabledAt),
        })
        .returning({ id: schema.userMfa.userId });
      return rows.length === 1;
    });
  }

  enable(id: UserId, step: number, recoveryHashes: string[]): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .update(schema.userMfa)
        .set({ enabledAt: new Date(), lastUsedStep: step, recoveryHashes })
        .where(and(eq(schema.userMfa.userId, id), isNull(schema.userMfa.enabledAt)))
        .returning({ id: schema.userMfa.userId });
      return rows.length === 1;
    });
  }

  advanceStep(id: UserId, step: number): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .update(schema.userMfa)
        .set({ lastUsedStep: step })
        .where(and(eq(schema.userMfa.userId, id), sql`${schema.userMfa.lastUsedStep} < ${step}`))
        .returning({ id: schema.userMfa.userId });
      return rows.length === 1;
    });
  }

  consumeRecovery(id: UserId, hash: string): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .update(schema.userMfa)
        .set({ recoveryHashes: sql`array_remove(${schema.userMfa.recoveryHashes}, ${hash})` })
        .where(
          and(
            eq(schema.userMfa.userId, id),
            sql`${schema.userMfa.enabledAt} is not null`,
            sql`${hash} = any(${schema.userMfa.recoveryHashes})`,
          ),
        )
        .returning({ id: schema.userMfa.userId });
      return rows.length === 1;
    });
  }

  async replaceRecovery(id: UserId, hashes: string[]): Promise<void> {
    await withSystem(this.systemDb, (tx) =>
      tx
        .update(schema.userMfa)
        .set({ recoveryHashes: hashes })
        .where(eq(schema.userMfa.userId, id)),
    );
  }

  remove(id: UserId): Promise<boolean> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .delete(schema.userMfa)
        .where(eq(schema.userMfa.userId, id))
        .returning({ id: schema.userMfa.userId });
      return rows.length === 1;
    });
  }
}

export class DrizzleEmailCodeRepository implements EmailCodeRepository {
  constructor(private readonly systemDb: Database) {}

  find(email: string, purpose: EmailCodePurpose): Promise<EmailCodeRecord | null> {
    const c = schema.emailCodes;
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx
        .select()
        .from(c)
        .where(and(eq(c.email, email), eq(c.purpose, purpose)))
        .limit(1);
      return row ?? null;
    });
  }

  async put(record: EmailCodeRecord): Promise<void> {
    const { codeHash, attempts, sentAt, expiresAt } = record;
    await withSystem(this.systemDb, (tx) =>
      tx
        .insert(schema.emailCodes)
        .values({ ...record })
        .onConflictDoUpdate({
          target: [schema.emailCodes.email, schema.emailCodes.purpose],
          set: { codeHash, attempts, sentAt, expiresAt },
        }),
    );
  }

  async addAttempt(email: string, purpose: EmailCodePurpose): Promise<void> {
    const c = schema.emailCodes;
    await withSystem(this.systemDb, (tx) =>
      tx
        .update(c)
        .set({ attempts: sql`${c.attempts} + 1` })
        .where(and(eq(c.email, email), eq(c.purpose, purpose))),
    );
  }

  async delete(email: string, purpose: EmailCodePurpose): Promise<void> {
    const c = schema.emailCodes;
    await withSystem(this.systemDb, (tx) =>
      tx.delete(c).where(and(eq(c.email, email), eq(c.purpose, purpose))),
    );
  }
}
