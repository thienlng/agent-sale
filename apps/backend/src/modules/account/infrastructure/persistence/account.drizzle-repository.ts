import {
  and,
  asc,
  type Database,
  desc,
  eq,
  inArray,
  notInArray,
  or,
  schema,
  type SQL,
  sql,
  type TenantTx,
  withSystem,
  writePlatformAudit,
  writeSystemOutbox,
} from '@agent-sales/db';
import type { UserId } from '@agent-sales/shared';

import {
  type AccountMembership,
  type AccountStatus,
  type AdminAccount,
  type AdminAccountMember,
  type AdminAccountQuery,
  decodeAccountCursor,
  encodeAccountCursor,
  type NewAccount,
} from '../../domain/account.js';
import { AccountNotFoundError } from '../../domain/account.errors.js';
import type { AccountRepository, OperatorAction } from '../../domain/ports/account.repository.js';

const a = schema.accounts;
/** Cursors carry a JS Date (ms): order and compare at ms so no row falls between two pages. */
const createdAtMs = sql`date_trunc('milliseconds', ${a.createdAt})`;

/** The oldest active owner of the account. */
const ownerOf = sql<
  string | null
>`(select ${schema.accountMembers.userId} from ${schema.accountMembers}
  where ${schema.accountMembers.accountId} = ${a.id} and ${schema.accountMembers.role} = 'owner'
    and ${schema.accountMembers.status} = 'active'
  order by ${schema.accountMembers.createdAt} limit 1)`;

const adminColumns = {
  id: a.id,
  name: a.name,
  status: a.status,
  statusReason: a.statusReason,
  statusChangedAt: a.statusChangedAt,
  createdAt: a.createdAt,
  ownerUserId: ownerOf,
};

/** System role (accounts are global, ADR-012 §1); every read is filtered by the user. */
export class DrizzleAccountRepository implements AccountRepository {
  constructor(private readonly systemDb: Database) {}

  membershipsOf(user: UserId): Promise<AccountMembership[]> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select({
          accountId: schema.accounts.id,
          name: schema.accounts.name,
          role: schema.accountMembers.role,
        })
        .from(schema.accountMembers)
        .innerJoin(schema.accounts, eq(schema.accounts.id, schema.accountMembers.accountId))
        .where(
          and(
            eq(schema.accountMembers.userId, user),
            eq(schema.accountMembers.status, 'active'),
            eq(schema.accounts.status, 'active'),
          ),
        )
        .orderBy(asc(schema.accounts.createdAt), asc(schema.accounts.id));
      return rows.map((r) => ({ ...r, role: r.role === 'billing' ? 'billing' : 'owner' }));
    });
  }

  namesOf(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return Promise.resolve(new Map());
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select({ id: schema.accounts.id, name: schema.accounts.name })
        .from(schema.accounts)
        .where(inArray(schema.accounts.id, [...ids]));
      return new Map(rows.map((r) => [r.id, r.name]));
    });
  }

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
      if (choice.createdEvent) {
        await writeSystemOutbox(tx, {
          type: 'account.account.created.v1',
          aggregateType: 'account',
          aggregateId: choice.id,
          payload: choice.createdEvent,
        });
      }
      return choice.id;
    });
  }

  listForAdmin(
    query: AdminAccountQuery,
  ): Promise<{ data: AdminAccount[]; nextCursor: string | null }> {
    return withSystem(this.systemDb, async (tx) => {
      const where: (SQL | undefined)[] = [];
      if (query.status) where.push(eq(a.status, query.status));
      if (query.accountIds) {
        if (!query.accountIds.length) return { data: [], nextCursor: null };
        where.push(inArray(a.id, [...query.accountIds]));
      }
      if (query.excludeAccountIds?.length) {
        where.push(notInArray(a.id, [...query.excludeAccountIds]));
      }
      if (query.q) {
        const like = `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        const owners = query.ownerUserIds?.length
          ? sql`exists (select 1 from ${schema.accountMembers} m where m.account_id = ${a.id}
              and m.status = 'active' and m.user_id in ${[...query.ownerUserIds]})`
          : undefined;
        where.push(or(sql`${a.name} ilike ${like}`, owners));
      }
      const after = query.cursor ? decodeAccountCursor(query.cursor) : null;
      if (after) {
        where.push(
          sql`(${createdAtMs}, ${a.id}) < (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`,
        );
      }
      const rows = await tx
        .select(adminColumns)
        .from(a)
        .where(and(...where))
        .orderBy(sql`${createdAtMs} desc`, desc(a.id))
        .limit(query.limit + 1);
      const page = rows.slice(0, query.limit).map(toAdmin);
      const last = page.at(-1);
      return {
        data: page,
        nextCursor:
          rows.length > query.limit && last ? encodeAccountCursor(last.createdAt, last.id) : null,
      };
    });
  }

  byIds(ids: readonly string[]): Promise<AdminAccount[]> {
    if (!ids.length) return Promise.resolve([]);
    return withSystem(this.systemDb, async (tx) =>
      (
        await tx
          .select(adminColumns)
          .from(a)
          .where(inArray(a.id, [...ids]))
      ).map(toAdmin),
    );
  }

  membersOf(accountId: string): Promise<AdminAccountMember[]> {
    return withSystem(this.systemDb, async (tx) => {
      const rows = await tx
        .select({ userId: schema.accountMembers.userId, role: schema.accountMembers.role })
        .from(schema.accountMembers)
        .where(
          and(
            eq(schema.accountMembers.accountId, accountId),
            eq(schema.accountMembers.status, 'active'),
          ),
        )
        .orderBy(asc(schema.accountMembers.createdAt));
      return rows.map((r) => ({
        userId: r.userId,
        role: r.role === 'billing' ? 'billing' : 'owner',
      }));
    });
  }

  setStatus(
    accountId: string,
    status: AccountStatus,
    action: OperatorAction,
    check: (from: AccountStatus) => void,
    now: Date,
  ): Promise<AccountStatus> {
    return withSystem(this.systemDb, async (tx) => {
      const [row] = await tx
        .select({ status: a.status })
        .from(a)
        .where(eq(a.id, accountId))
        .for('update');
      if (!row) throw new AccountNotFoundError(accountId);
      const from = row.status === 'suspended' ? 'suspended' : 'active';
      check(from);
      await tx
        .update(a)
        .set({ status, statusReason: action.reason, statusChangedAt: now, updatedAt: now })
        .where(eq(a.id, accountId));
      await writePlatformAudit(tx, {
        actorUserId: action.actorUserId,
        actorName: action.actorName,
        action: status === 'suspended' ? 'account.suspended' : 'account.reactivated',
        targetType: 'account',
        targetId: accountId,
        reason: action.reason,
        data: { from, to: status },
      });
      await writeSystemOutbox(tx, {
        type: 'account.account.status_changed.v1',
        aggregateType: 'account',
        aggregateId: accountId,
        payload: {
          type: 'account.account.status_changed.v1',
          accountId,
          status,
          occurredAt: now.toISOString(),
        },
      });
      return from;
    });
  }
}

function toAdmin(r: {
  id: string;
  name: string;
  status: string;
  statusReason: string;
  statusChangedAt: Date | null;
  createdAt: Date;
  ownerUserId: string | null;
}): AdminAccount {
  return { ...r, status: r.status === 'suspended' ? 'suspended' : 'active' };
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
        // A suspended account still owns new businesses: suspension is not escaped by creating one.
        inArray(schema.accounts.status, ['active', 'suspended']),
      ),
    )
    .orderBy(asc(schema.accounts.createdAt), asc(schema.accounts.id));
  return rows.map((r) => r.id);
}
