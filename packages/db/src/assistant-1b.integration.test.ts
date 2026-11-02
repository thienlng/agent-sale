import { newId, userId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withAccount } from './account.js';
import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import {
  accounts,
  assistantMemory,
  assistantMessages,
  assistantProposals,
  assistantThreads,
  users,
  workspaces,
} from './schema/index.js';
import { withSystem } from './tenant.js';

/**
 * Owner assistant 1b tables (0057, ADR-023): account RLS on `assistant_memory` and
 * `assistant_proposals`, the store CHECK, the proposal status guard under concurrency, and
 * `assistant_messages.sort_seq`. One connection per client (`max: 1`) mimics PgBouncer.
 */
let pg: TestPostgres;
let tenantDb: { db: Database; close: () => Promise<void> };
let tenantDb2: { db: Database; close: () => Promise<void> };
let systemDb: { db: Database; close: () => Promise<void> };
const fixtures: { account: string; owner: string; thread: string; business: string }[] = [];

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, {
    tenant: pg.tenantLogin,
    system: pg.systemLogin,
    assistantSql: pg.assistantSqlLogin,
  });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  tenantDb = createDb({ url: tenantUrl, max: 1 });
  tenantDb2 = createDb({ url: tenantUrl, max: 1 });
  systemDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  for (let i = 0; i < 2; i++) {
    const f = { account: newId(), owner: userId(newId()), thread: newId(), business: newId() };
    await withSystem(systemDb.db, async (tx) => {
      await tx.insert(users).values({ id: f.owner, email: `${f.owner}@example.test`, name: 'O' });
      await tx
        .insert(accounts)
        .values({ id: f.account, name: `acc-${i}`, createdByUserId: f.owner });
      await tx.insert(workspaces).values({
        id: f.business,
        workspaceId: f.business,
        name: `Shop ${i}`,
        industry: 'fashion',
        ownerUserId: f.owner,
        accountId: f.account,
      });
      await tx.insert(assistantThreads).values({
        id: f.thread,
        accountId: f.account,
        ownerUserId: f.owner,
        systemPrompt: 'p',
        promptVersion: 'v1',
      });
    });
    fixtures.push(f);
  }
});

afterAll(async () => {
  await Promise.all([tenantDb?.close(), tenantDb2?.close(), systemDb?.close()]);
  await pg?.stop();
});

const proposalRow = (f: (typeof fixtures)[number]) => ({
  id: newId(),
  accountId: f.account,
  ownerUserId: f.owner,
  threadId: f.thread,
  businessId: f.business,
  routeKey: 'PATCH /products/{productId}',
  path: '/products/p1',
  body: { price: 1 },
  summary: 'Đổi giá',
  expiresAt: new Date(Date.now() + 86_400_000),
});

describe('assistant 1b tables (0057)', () => {
  it('keeps memory per account under RLS and checks the store name', async () => {
    const [a, b] = fixtures as [(typeof fixtures)[0], (typeof fixtures)[0]];
    for (const f of [a, b]) {
      await withAccount(tenantDb.db, f.account, (tx) =>
        tx.insert(assistantMemory).values({
          accountId: f.account,
          ownerUserId: f.owner,
          store: `business:${f.business}`,
          entries: [{ id: '1', text: f.account, origin: 'owner', createdAt: 'x' }],
        }),
      );
    }
    for (const f of [a, b]) {
      const rows = await withAccount(tenantDb.db, f.account, (tx) =>
        tx.select().from(assistantMemory),
      );
      expect(rows.map((r) => r.accountId)).toEqual([f.account]);
    }
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx
          .insert(assistantMemory)
          .values({ accountId: b.account, ownerUserId: b.owner, store: 'notes' }),
      ),
    ).rejects.toThrow();
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx
          .insert(assistantMemory)
          .values({ accountId: a.account, ownerUserId: a.owner, store: 'secrets' }),
      ),
    ).rejects.toThrow();
  });

  it('hides proposals of another account and lets one of two concurrent approvals win', async () => {
    const [a, b] = fixtures as [(typeof fixtures)[0], (typeof fixtures)[0]];
    const row = proposalRow(a);
    await withAccount(tenantDb.db, a.account, (tx) => tx.insert(assistantProposals).values(row));
    const seen = await withAccount(tenantDb.db, b.account, (tx) =>
      tx.select().from(assistantProposals),
    );
    expect(seen).toEqual([]);

    const approve = (db: Database) =>
      withAccount(db, a.account, (tx) =>
        tx
          .update(assistantProposals)
          .set({ status: 'executing' })
          .where(
            and(eq(assistantProposals.id, row.id), inArray(assistantProposals.status, ['pending'])),
          )
          .returning({ id: assistantProposals.id }),
      );
    const results = await Promise.all([approve(tenantDb.db), approve(tenantDb2.db)]);
    expect(results.map((r) => r.length).sort()).toEqual([0, 1]);

    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantProposals).values({ ...proposalRow(a), summary: 'x'.repeat(301) }),
      ),
    ).rejects.toThrow();
  });

  it('fills sort_seq from seq when an insert omits it, and defaults the thread columns', async () => {
    const a = fixtures[0]!;
    const sortSeq = await withAccount(tenantDb.db, a.account, async (tx) => {
      await tx.execute(sql`
        insert into assistant_messages (id, account_id, owner_user_id, thread_id, seq, role, content)
        values (${newId()}, ${a.account}, ${a.owner}, ${a.thread}, 7, 'user', 'old writer')`);
      const [m] = await tx
        .select({ sortSeq: assistantMessages.sortSeq })
        .from(assistantMessages)
        .where(eq(assistantMessages.threadId, a.thread));
      return m?.sortSeq;
    });
    expect(sortSeq).toBe(7);
    const [thread] = await withAccount(tenantDb.db, a.account, (tx) =>
      tx.select().from(assistantThreads).where(eq(assistantThreads.id, a.thread)),
    );
    expect(thread).toMatchObject({
      cacheRootId: null,
      compactedAt: null,
      compactionFailedAt: null,
      compactionSavedPcts: [],
    });
  });
});
