import { newId, userId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { withAccount } from './account.js';
import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import {
  accounts,
  assistantImportBatches,
  assistantProposals,
  assistantRuns,
  assistantThreads,
  users,
  workspaces,
} from './schema/index.js';
import { withSystem } from './tenant.js';

/**
 * Owner assistant import tables (0061, T-173): account RLS on `assistant_import_batches`, the
 * proposal kind/batch CHECKs, the cascade from the thread, per-key result writes under
 * concurrency, and the `import_vision` run kind. One connection per client (`max: 1`) mimics
 * PgBouncer.
 */
let pg: TestPostgres;
let tenantDb: { db: Database; close: () => Promise<void> };
let tenantDb2: { db: Database; close: () => Promise<void> };
let systemDb: { db: Database; close: () => Promise<void> };
type Fixture = { account: string; owner: string; thread: string; business: string };
const fixtures: Fixture[] = [];

async function fixture(i: number): Promise<Fixture> {
  const f = { account: newId(), owner: userId(newId()), thread: newId(), business: newId() };
  await withSystem(systemDb.db, async (tx) => {
    await tx.insert(users).values({ id: f.owner, email: `${f.owner}@example.test`, name: 'O' });
    await tx.insert(accounts).values({ id: f.account, name: `acc-${i}`, createdByUserId: f.owner });
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
  return f;
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  tenantDb = createDb({ url: tenantUrl, max: 1 });
  tenantDb2 = createDb({ url: tenantUrl, max: 1 });
  systemDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  for (let i = 0; i < 2; i++) fixtures.push(await fixture(i));
});

afterAll(async () => {
  await Promise.all([tenantDb?.close(), tenantDb2?.close(), systemDb?.close()]);
  await pg?.stop();
});

const batchRow = (f: Fixture) => ({
  id: newId(),
  accountId: f.account,
  ownerUserId: f.owner,
  threadId: f.thread,
  businessId: f.business,
  kind: 'sheet',
  fileName: 'sp.xlsx',
  source: { kind: 'sheet', rows: [['Tên', 'Giá']] },
  rowCount: 1,
});

const importProposal = (f: Fixture, importBatchId: string | null) => ({
  id: newId(),
  accountId: f.account,
  ownerUserId: f.owner,
  threadId: f.thread,
  businessId: f.business,
  routeKey: 'POST /products',
  path: '/products',
  summary: 'Tạo 2 sản phẩm',
  kind: 'product_import',
  importBatchId,
  expiresAt: new Date(Date.now() + 86_400_000),
});

describe('assistant import tables (0061)', () => {
  it('keeps batches per account under RLS on one pooled connection', async () => {
    const [a, b] = fixtures as [Fixture, Fixture];
    const rows = [batchRow(a), batchRow(b)];
    for (const [i, f] of [a, b].entries()) {
      await withAccount(tenantDb.db, f.account, (tx) =>
        tx.insert(assistantImportBatches).values(rows[i]!),
      );
    }
    for (const [i, f] of [a, b].entries()) {
      const seen = await withAccount(tenantDb.db, f.account, (tx) =>
        tx.select().from(assistantImportBatches),
      );
      expect(seen.map((r) => r.id)).toEqual([rows[i]!.id]);
      expect(seen[0]).toMatchObject({
        status: 'ready',
        overrides: {},
        excluded: [],
        results: {},
        drafts: null,
      });
    }
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantImportBatches).values(batchRow(b)),
      ),
    ).rejects.toThrow();
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantImportBatches).values({ ...batchRow(a), kind: 'pdf' }),
      ),
    ).rejects.toThrow();
  });

  it('keeps both results of two concurrent per-key writes', async () => {
    const a = fixtures[0]!;
    const row = batchRow(a);
    await withAccount(tenantDb.db, a.account, (tx) =>
      tx.insert(assistantImportBatches).values(row),
    );
    const record = (db: Database, key: string) =>
      withAccount(db, a.account, (tx) =>
        tx
          .update(assistantImportBatches)
          .set({
            results: sql`${assistantImportBatches.results} || jsonb_build_object(${key}::text, ${JSON.stringify({ status: 'not_run' })}::jsonb)`,
          })
          .where(eq(assistantImportBatches.id, row.id)),
      );
    await Promise.all([record(tenantDb.db, 'r1'), record(tenantDb2.db, 'r2')]);
    const [stored] = await withAccount(tenantDb.db, a.account, (tx) =>
      tx.select().from(assistantImportBatches).where(eq(assistantImportBatches.id, row.id)),
    );
    expect(stored?.results).toEqual({ r1: { status: 'not_run' }, r2: { status: 'not_run' } });
  });

  it('ties product_import proposals to a batch and keeps route proposals as before', async () => {
    const a = fixtures[0]!;
    const batch = batchRow(a);
    await withAccount(tenantDb.db, a.account, (tx) =>
      tx.insert(assistantImportBatches).values(batch),
    );
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantProposals).values(importProposal(a, null)),
      ),
    ).rejects.toThrow();
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantProposals).values({ ...importProposal(a, batch.id), kind: 'route' }),
      ),
    ).rejects.toThrow();
    await expect(
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantProposals).values({ ...importProposal(a, null), kind: 'bogus' }),
      ),
    ).rejects.toThrow();
    const ok = importProposal(a, batch.id);
    await withAccount(tenantDb.db, a.account, (tx) => tx.insert(assistantProposals).values(ok));

    // An older writer that does not know the column still inserts route proposals.
    const routeId = newId();
    await withAccount(tenantDb.db, a.account, (tx) =>
      tx.execute(sql`
        insert into assistant_proposals
          (id, account_id, owner_user_id, thread_id, business_id, route_key, path, summary, expires_at)
        values (${routeId}, ${a.account}, ${a.owner}, ${a.thread}, ${a.business},
          'PATCH /products/{productId}', '/products/p1', 'Đổi giá', now() + interval '1 day')`),
    );
    const kinds = await withAccount(tenantDb.db, a.account, (tx) =>
      tx
        .select({ id: assistantProposals.id, kind: assistantProposals.kind })
        .from(assistantProposals),
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        { id: ok.id, kind: 'product_import' },
        { id: routeId, kind: 'route' },
      ]),
    );
  });

  it('deletes the batches and their proposals with the thread', async () => {
    const f = await fixture(9);
    const batch = batchRow(f);
    const proposal = importProposal(f, batch.id);
    await withAccount(tenantDb.db, f.account, async (tx) => {
      await tx.insert(assistantImportBatches).values(batch);
      await tx.insert(assistantProposals).values(proposal);
    });
    await withAccount(tenantDb.db, f.account, (tx) =>
      tx.delete(assistantThreads).where(eq(assistantThreads.id, f.thread)),
    );
    const left = await withAccount(tenantDb.db, f.account, async (tx) => ({
      batches: await tx.select().from(assistantImportBatches),
      proposals: await tx.select().from(assistantProposals),
    }));
    expect(left).toEqual({ batches: [], proposals: [] });
  });

  it('accepts the import_vision run kind and keeps the older kinds', async () => {
    const a = fixtures[0]!;
    const run = (kind: string) =>
      withAccount(tenantDb.db, a.account, (tx) =>
        tx.insert(assistantRuns).values({
          id: newId(),
          accountId: a.account,
          ownerUserId: a.owner,
          kind,
          status: 'done',
          tier: 'pro',
          promptVersion: 'assistant-import-vision@1',
        }),
      );
    // All migrations (0058–0062) applied in order: every capability's run kind is accepted.
    for (const kind of [
      'import_vision',
      'chat',
      'compaction',
      'review',
      'curator',
      'title',
      'schedule',
    ]) {
      await run(kind);
    }
    await expect(run('bogus')).rejects.toThrow();
  });
});
