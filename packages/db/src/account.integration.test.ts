import { newId, userId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withAccount } from './account.js';
import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import { accounts, assistantMessages, assistantThreads, users } from './schema/index.js';
import { withSystem } from './tenant.js';

/**
 * Proves account-scoped RLS for the owner assistant tables (ADR-004 amendment, ADR-022).
 * One connection per client (`max: 1`) mimics PgBouncer transaction pooling, so a
 * leaked session setting would show up as a cross-account read.
 */
let pg: TestPostgres;
let tenantDb: { db: Database; close: () => Promise<void> };
let systemDb: { db: Database; close: () => Promise<void> };
const accountIds: string[] = [];
const ownerIds: string[] = [];
const threadIds: string[] = [];

function threadRow(accountId: string, ownerUserId: string, id = newId()) {
  return {
    id,
    accountId,
    ownerUserId,
    title: 'Doanh thu',
    systemPrompt: 'You are the owner assistant.',
    promptVersion: 'v1',
  };
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  tenantDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });
  systemDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });

  for (let i = 0; i < 2; i++) {
    const owner = userId(newId());
    const account = newId();
    const thread = newId();
    await withSystem(systemDb.db, async (tx) => {
      await tx.insert(users).values({ id: owner, email: `${owner}@example.test`, name: 'Owner' });
      await tx.insert(accounts).values({ id: account, name: `acc-${i}`, createdByUserId: owner });
      await tx.insert(assistantThreads).values(threadRow(account, owner, thread));
    });
    ownerIds.push(owner);
    accountIds.push(account);
    threadIds.push(thread);
  }
});

afterAll(async () => {
  await Promise.all([tenantDb?.close(), systemDb?.close()]);
  await pg?.stop();
});

describe('account-scoped assistant tables (ADR-022)', () => {
  it('each account sees only its own threads, alternating on one reused connection', async () => {
    const [a, b] = accountIds as [string, string];
    const [threadA, threadB] = threadIds as [string, string];
    for (let i = 0; i < 3; i++) {
      for (const [mine, mineThread, otherThread] of [
        [a, threadA, threadB],
        [b, threadB, threadA],
      ] as const) {
        const rows = await withAccount(tenantDb.db, mine, (tx) =>
          tx.select().from(assistantThreads),
        );
        expect(rows.map((r) => r.id)).toEqual([mineThread]);
        expect(rows.map((r) => r.id)).not.toContain(otherThread);
      }
    }
  });

  it('a tenant query outside withAccount sees no assistant rows', async () => {
    await withAccount(tenantDb.db, accountIds[0]!, (tx) => tx.select().from(assistantThreads));
    const rows = await tenantDb.db.select().from(assistantThreads);
    expect(rows).toEqual([]);
  });

  it('an account cannot write a thread for another account', async () => {
    await expect(
      withAccount(tenantDb.db, accountIds[0]!, (tx) =>
        tx.insert(assistantThreads).values(threadRow(accountIds[1]!, ownerIds[1]!)),
      ),
    ).rejects.toThrow();
  });

  it('finds a message by accent-insensitive full-text search', async () => {
    const account = accountIds[0]!;
    const found = await withAccount(tenantDb.db, account, async (tx) => {
      await tx.insert(assistantMessages).values({
        id: newId(),
        accountId: account,
        ownerUserId: ownerIds[0]!,
        threadId: threadIds[0]!,
        seq: 1,
        sortSeq: 1,
        role: 'user',
        content: 'Báo cáo doanh thu',
      });
      return tx.execute<{ content: string }>(
        sql`select content from assistant_messages
            where search @@ plainto_tsquery('simple', assistant_unaccent('bao cao'))`,
      );
    });
    expect(found.map((r) => r.content)).toEqual(['Báo cáo doanh thu']);
  });
});
