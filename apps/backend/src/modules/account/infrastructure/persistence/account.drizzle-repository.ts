import {
  and,
  asc,
  type Database,
  eq,
  schema,
  sql,
  type TenantTx,
  withSystem,
} from '@agent-sales/db';
import type { UserId } from '@agent-sales/shared';

import type { NewAccount } from '../../domain/account.js';
import type { AccountRepository } from '../../domain/ports/account.repository.js';

/** System role (accounts are global, ADR-012 §1); every read is filtered by the user. */
export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly systemDb: Database) {}

  resolveForOwner(user: UserId, decide: (owned: string[]) => string | NewAccount): Promise<string> {
    return withSystem(this.systemDb, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`account-owner/${user}`},0))`,
      );
      const choice = decide(await owned(tx, user));
      if (typeof choice === 'string') return choice;
      await tx.insert(schema.accounts).values({
        id: choice.id,
        name: choice.name,
        createdByUserId: choice.ownerUserId,
      });
      await tx
        .insert(schema.accountMembers)
        .values({ accountId: choice.id, userId: choice.ownerUserId, role: 'owner' });
      return choice.id;
    });
  }
}

async function owned(tx: TenantTx, user: UserId): Promise<string[]> {
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
}
