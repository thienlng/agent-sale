import { and, asc, type Database, eq, schema, withSystem } from '@agent-sales/db';
import type { UserId } from '@agent-sales/shared';

import type { NewAccount } from '../../domain/account.js';
import type { AccountRepository } from '../../domain/ports/account.repository.js';

/** System role (accounts are global, ADR-012 §1); every read is filtered by the user. */
export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly systemDb: Database) {}

  ownedBy(user: UserId): Promise<string[]> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select({ id: schema.accounts.id })
        .from(schema.accountMembers)
        .innerJoin(schema.accounts, eq(schema.accounts.id, schema.accountMembers.accountId))
        .where(
          and(
            eq(schema.accountMembers.userId, user),
            eq(schema.accountMembers.role, 'owner'),
            eq(schema.accountMembers.status, 'active'),
            eq(schema.accounts.status, 'active'),
          ),
        )
        .orderBy(asc(schema.accounts.createdAt), asc(schema.accounts.id));
      return rows.map((r) => r.id);
    });
  }

  createWithOwner(account: NewAccount): Promise<void> {
    return withSystem(this.systemDb, async (tx) => {
      await tx.insert(schema.accounts).values({
        id: account.id,
        name: account.name,
        createdByUserId: account.ownerUserId,
      });
      await tx
        .insert(schema.accountMembers)
        .values({ accountId: account.id, userId: account.ownerUserId, role: 'owner' });
    });
  }
}
