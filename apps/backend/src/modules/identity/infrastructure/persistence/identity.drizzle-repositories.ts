import { and, type Database, eq, isNull, schema, sql, withSystem } from '@agent-sales/db';
import { type UserId, userId } from '@agent-sales/shared';

import { EmailTakenError } from '../../domain/identity.errors.js';
import type { MfaRecord, MfaRepository } from '../../domain/ports/mfa.repository.js';
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

  async insert(user: User): Promise<void> {
    const s = user.snapshot();
    try {
      await withSystem(this.systemDb, (tx) =>
        tx.insert(schema.users).values({
          id: s.id,
          email: s.email,
          name: s.name,
          phone: s.phone,
          passwordHash: s.passwordHash,
          locale: s.locale,
          timezone: s.timezone,
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
