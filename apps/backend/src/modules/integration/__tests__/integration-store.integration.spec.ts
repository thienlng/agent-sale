import {
  createDb,
  type Database,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
  withSystem,
  withTenant,
} from '@agent-sales/db';
import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ConnectionRecord } from '../application/ports/integration-store.js';
import {
  ConnectionExistsError,
  ConnectionNotFoundError,
  ConnectionVersionConflictError,
} from '../domain/integration.errors.js';
import { DrizzleIntegrationStore } from '../infrastructure/persistence/integration.drizzle-store.js';

/** Integration persistence on a real Postgres: connections, leased jobs, webhook claims, log, cache. */
let pg: TestPostgres;
let tenant: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };
let store: DrizzleIntegrationStore;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
  });
  system = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
  store = new DrizzleIntegrationStore(tenant.db, system.db);
});

afterAll(async () => {
  await Promise.all([tenant?.close(), system?.close()]);
  await pg?.stop();
});

async function workspace(): Promise<WorkspaceId> {
  const ws = workspaceId(newId());
  const owner = userId(newId());
  await withSystem(system.db, (tx) =>
    tx.insert(schema.users).values({ id: owner, email: `${owner}@example.test`, name: 'Owner' }),
  );
  await withTenant(tenant.db, ws, (tx) =>
    tx.insert(schema.workspaces).values({
      id: ws,
      workspaceId: ws,
      name: `ws-${ws.slice(-4)}`,
      industry: 'retail',
      ownerUserId: owner,
    }),
  );
  return ws;
}

function record(ws: WorkspaceId, over: Partial<ConnectionRecord> = {}): ConnectionRecord {
  const id = newId();
  const now = new Date();
  return {
    id,
    workspaceId: ws,
    provider: 'kiotviet',
    status: 'connected',
    retailer: 'shoplan',
    clientId: 'client',
    clientSecretSealed: 'sealed-secret',
    webhookToken: `token-${id}`,
    webhookSecretSealed: 'sealed-webhook-secret',
    settings: { saleBranchIds: [1], orderBranchId: 1, pushOrders: false, syncCustomers: false },
    version: 1,
    progress: null,
    counts: {},
    lastError: null,
    lastFullSyncAt: null,
    lastReconcileAt: null,
    connectedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

async function connected(): Promise<{ ws: WorkspaceId; c: ConnectionRecord }> {
  const ws = await workspace();
  const c = record(ws);
  await store.insertConnection(ws, c);
  return { ws, c };
}

/** Claims until the given job shows up (other tests' jobs may be ready too). */
async function claimOne(jobId: string, leaseMs = 60_000) {
  for (let i = 0; i < 20; i++) {
    const jobs = await store.claimJobs(50, leaseMs);
    const mine = jobs.find((j) => j.id === jobId);
    if (mine) return mine;
    if (jobs.length === 0) break;
  }
  return undefined;
}

const job = (id: string) =>
  withSystem(system.db, async (tx) => {
    const [r] = await tx
      .select()
      .from(schema.integrationJobs)
      .where(eq(schema.integrationJobs.id, id));
    return r!;
  });

async function onlyJobOf(ws: WorkspaceId, connectionId: string) {
  const rows = await withTenant(tenant.db, ws, (tx) =>
    tx
      .select()
      .from(schema.integrationJobs)
      .where(eq(schema.integrationJobs.connectionId, connectionId)),
  );
  expect(rows).toHaveLength(1);
  return rows[0]!;
}

describe('integration store on Postgres', () => {
  it('inserts a connection, reads it back and refuses a second live one', async () => {
    const { ws, c } = await connected();
    const live = await store.liveConnection(ws, 'kiotviet');
    expect(live).toMatchObject({
      id: c.id,
      status: 'connected',
      settings: c.settings,
      version: 1,
      counts: {},
      progress: null,
      lastError: null,
    });
    await expect(store.insertConnection(ws, record(ws))).rejects.toBeInstanceOf(
      ConnectionExistsError,
    );

    // A disconnected connection frees the slot.
    await store.updateConnection(ws, c.id, { status: 'disconnected' });
    expect(await store.liveConnection(ws, 'kiotviet')).toBeNull();
    await store.insertConnection(ws, record(ws));
    expect((await store.liveConnection(ws, 'kiotviet'))?.id).not.toBe(c.id);
  });

  it('bumps the version only on owner edits and enforces an expected version', async () => {
    const { ws, c } = await connected();
    // Runner writes keep the version.
    const syncing = await store.updateConnection(
      ws,
      c.id,
      { status: 'syncing', progress: { phase: 'products', done: 0, total: null } },
      1,
    );
    expect(syncing).toMatchObject({
      status: 'syncing',
      version: 1,
      progress: { phase: 'products', done: 0, total: null },
    });
    const runner = await store.updateConnection(ws, c.id, {
      counts: { products: 3 },
      lastError: { code: 'kiotviet_unavailable', at: new Date().toISOString() },
      lastFullSyncAt: new Date(),
      lastReconcileAt: new Date(),
    });
    expect(runner.version).toBe(1);
    expect(runner.updatedAt.getTime()).toBeGreaterThanOrEqual(syncing.updatedAt.getTime());

    // Owner edits bump it, one per write.
    const settings = { ...c.settings, pushOrders: true };
    expect((await store.updateConnection(ws, c.id, { settings }, 1)).version).toBe(2);
    expect((await store.updateConnection(ws, c.id, { retailer: 'shopmoi' })).version).toBe(3);
    expect((await store.updateConnection(ws, c.id, { clientId: 'client-2' })).version).toBe(4);
    expect(
      (await store.updateConnection(ws, c.id, { clientSecretSealed: 'sealed-2' })).version,
    ).toBe(5);

    // A stale expected version is refused for any patch, and nothing is written.
    await expect(
      store.updateConnection(ws, c.id, { status: 'connected' }, 1),
    ).rejects.toBeInstanceOf(ConnectionVersionConflictError);
    await expect(
      store.updateConnection(ws, c.id, { settings: c.settings }, 4),
    ).rejects.toBeInstanceOf(ConnectionVersionConflictError);
    expect(await store.connectionForSystem(c.id)).toMatchObject({
      status: 'syncing',
      version: 5,
      settings,
    });
    await expect(store.updateConnection(ws, newId(), { status: 'error' })).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
  });

  it('keeps tenant reads inside the workspace', async () => {
    const { c } = await connected();
    const other = await workspace();
    expect(await store.liveConnection(other, 'kiotviet')).toBeNull();
    await expect(store.updateConnection(other, c.id, { status: 'error' })).rejects.toBeInstanceOf(
      ConnectionNotFoundError,
    );
    expect((await store.connectionForSystem(c.id))?.workspaceId).toBe(c.workspaceId);
  });

  it('keeps one open sync per connection but any number of webhook jobs', async () => {
    const { ws, c } = await connected();
    expect(await store.enqueue(ws, { connectionId: c.id, kind: 'full_import' })).toBe(true);
    expect(await store.enqueue(ws, { connectionId: c.id, kind: 'reconcile' })).toBe(false);
    expect(
      await store.enqueue(ws, { connectionId: c.id, kind: 'webhook', payload: { a: 1 } }),
    ).toBe(true);
    expect(await store.enqueue(ws, { connectionId: c.id, kind: 'webhook' })).toBe(true);
  });

  it('claims, leases, retries and fails a job, fenced by the claim token', async () => {
    const { ws, c } = await connected();
    await store.enqueue(ws, { connectionId: c.id, kind: 'full_import', payload: { by: 'owner' } });
    const { id } = await onlyJobOf(ws, c.id);

    const first = await claimOne(id);
    expect(first).toMatchObject({
      workspaceId: ws,
      connectionId: c.id,
      kind: 'full_import',
      payload: { by: 'owner' },
      cursor: null,
      attempts: 0,
    });
    // Leased: not claimable again.
    expect(await claimOne(id)).toBeUndefined();

    expect(
      await store.saveCursor(
        id,
        first!.claimToken,
        { entity: 'products', currentItem: 100 },
        60_000,
      ),
    ).toBe(true);
    expect(await store.saveCursor(id, newId(), { entity: 'x' }, 60_000)).toBe(false);
    expect((await job(id)).cursor).toEqual({ entity: 'products', currentItem: 100 });

    // Retry later: not ready until run_after.
    expect(
      await store.retryJob(
        id,
        first!.claimToken,
        new Date(Date.now() + 60_000),
        'kiotviet_unavailable',
      ),
    ).toBe(true);
    expect(await claimOne(id)).toBeUndefined();
    expect(await job(id)).toMatchObject({ lastError: 'kiotviet_unavailable', leaseUntil: null });

    await withSystem(system.db, (tx) =>
      tx
        .update(schema.integrationJobs)
        .set({ runAfter: new Date(Date.now() - 1000) })
        .where(eq(schema.integrationJobs.id, id)),
    );
    const second = await claimOne(id);
    // The recorded failure counts; the re-claim itself does not.
    expect(second).toMatchObject({ attempts: 1, cursor: { entity: 'products', currentItem: 100 } });
    expect(second!.claimToken).not.toBe(first!.claimToken);

    // The old token no longer owns the job: every fenced write is refused and reports it.
    const stale = first!.claimToken;
    expect(await store.saveCursor(id, stale, { entity: 'stale' }, 60_000)).toBe(false);
    expect(await store.completeJob(id, stale)).toBe(false);
    expect(await store.retryJob(id, stale, new Date(), 'stale')).toBe(false);
    expect(await store.failJob(id, stale, 'stale')).toBe(false);
    expect(await job(id)).toMatchObject({
      doneAt: null,
      failedAt: null,
      lastError: 'kiotviet_unavailable',
      cursor: { entity: 'products', currentItem: 100 },
    });

    expect(await store.failJob(id, second!.claimToken, 'kiotviet_auth')).toBe(true);
    const failed = await job(id);
    expect(failed.failedAt).toBeInstanceOf(Date);
    expect(failed.lastError).toBe('kiotviet_auth');
    expect(await claimOne(id)).toBeUndefined();
    // A finished job refuses even its last owner.
    expect(await store.completeJob(id, second!.claimToken)).toBe(false);
    // A failed sync no longer blocks a new one.
    expect(await store.enqueue(ws, { connectionId: c.id, kind: 'reconcile' })).toBe(true);
  });

  it('reclaims a job whose lease ran out and completes it', async () => {
    const { ws, c } = await connected();
    await store.enqueue(ws, { connectionId: c.id, kind: 'reconcile' });
    const { id } = await onlyJobOf(ws, c.id);
    const first = await claimOne(id, 1);
    await new Promise((r) => setTimeout(r, 20));
    const second = await claimOne(id);
    // A lapsed lease is not a failure: a long import is never dead-lettered for taking long.
    expect(second?.attempts).toBe(0);
    expect(await store.completeJob(id, first!.claimToken)).toBe(false);
    expect(await store.completeJob(id, second!.claimToken)).toBe(true);
    expect((await job(id)).doneAt).toBeInstanceOf(Date);
  });

  it('extends the lease on saveCursor so a slow runner keeps its job', async () => {
    const { ws, c } = await connected();
    await store.enqueue(ws, { connectionId: c.id, kind: 'full_import' });
    const { id } = await onlyJobOf(ws, c.id);
    // A 300 ms lease that would run out during the page…
    const claimed = await claimOne(id, 300);
    expect(claimed).toBeDefined();
    // …is renewed by the page's cursor save before it expires.
    expect(await store.saveCursor(id, claimed!.claimToken, { currentItem: 100 }, 60_000)).toBe(
      true,
    );
    await new Promise((r) => setTimeout(r, 400));
    expect(await claimOne(id)).toBeUndefined();
    const row = await job(id);
    expect(row.leaseUntil!.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(await store.completeJob(id, claimed!.claimToken)).toBe(true);
  });

  it('never hands the same job to two concurrent claims', async () => {
    const { ws, c } = await connected();
    for (let i = 0; i < 10; i++) await store.enqueue(ws, { connectionId: c.id, kind: 'webhook' });
    const batches = await Promise.all(Array.from({ length: 4 }, () => store.claimJobs(5, 60_000)));
    const ids = batches.flat().map((j) => j.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('closes open jobs of a disconnected connection instead of claiming them', async () => {
    const { ws, c } = await connected();
    await store.enqueue(ws, { connectionId: c.id, kind: 'full_import' });
    const { id } = await onlyJobOf(ws, c.id);
    await store.updateConnection(ws, c.id, { status: 'disconnected' });
    expect(await claimOne(id)).toBeUndefined();
    expect((await job(id)).doneAt).toBeInstanceOf(Date);
  });

  it('claims webhook deliveries once, marking them processed', async () => {
    const { ws, c } = await connected();
    const gone = await connected();
    const insert = (w: WorkspaceId, connectionId: string, deliveryId: string) =>
      withTenant(tenant.db, w, (tx) =>
        tx.insert(schema.integrationWebhookEvents).values({
          id: newId(),
          workspaceId: w,
          connectionId,
          deliveryId,
          body: `{"Id":"${deliveryId}"}`,
          signature: 'sig',
        }),
      );
    await insert(ws, c.id, 'd1');
    await insert(ws, c.id, 'd2');
    await insert(gone.ws, gone.c.id, 'd3');
    await store.updateConnection(gone.ws, gone.c.id, { status: 'disconnected' });

    const [a, b] = await Promise.all([store.claimWebhookEvents(10), store.claimWebhookEvents(10)]);
    const claimed = [...a, ...b];
    expect(claimed.map((e) => e.body).sort()).toEqual(['{"Id":"d1"}', '{"Id":"d2"}']);
    expect(claimed[0]).toMatchObject({ workspaceId: ws, connectionId: c.id, signature: 'sig' });
    expect(await store.claimWebhookEvents(10)).toEqual([]);
    const open = await withSystem(system.db, (tx) =>
      tx.select().from(schema.integrationWebhookEvents),
    );
    expect(open.every((e) => e.processedAt !== null)).toBe(true);
  });

  it('keeps the newest 200 log entries per connection', async () => {
    const { ws, c } = await connected();
    for (let i = 0; i < 205; i++)
      await store.log(ws, c.id, { level: 'info', code: 'sync.page', params: { n: i } });
    await store.log(ws, c.id, { level: 'error', code: 'sync.failed' });
    const all = await store.recentLog(ws, c.id, 1000);
    expect(all).toHaveLength(200);
    expect(all[0]).toMatchObject({ level: 'error', code: 'sync.failed', params: {} });
    expect(all[1]?.params).toEqual({ n: 204 });
    expect(all.at(-1)?.params).toEqual({ n: 6 });
    expect(await store.recentLog(ws, c.id, 3)).toHaveLength(3);
  });

  it('caches an imported picture per workspace', async () => {
    const { ws } = await connected();
    const url = 'https://cdn.kiotviet.test/a.jpg';
    expect(await store.cachedImage(ws, url)).toBeNull();
    await store.cacheImage(ws, url, 'https://media.rapiz.test/a.jpg');
    await store.cacheImage(ws, url, 'https://media.rapiz.test/a2.jpg');
    expect(await store.cachedImage(ws, url)).toBe('https://media.rapiz.test/a2.jpg');
    expect(await store.cachedImage(await workspace(), url)).toBeNull();
  });

  it('lists connected or errored connections due for a reconcile', async () => {
    const due = await connected();
    const fresh = await connected();
    const errored = await connected();
    const gone = await connected();
    await store.updateConnection(fresh.ws, fresh.c.id, { lastReconcileAt: new Date() });
    await store.updateConnection(errored.ws, errored.c.id, {
      status: 'error',
      lastReconcileAt: new Date(Date.now() - 3_600_000),
    });
    await store.updateConnection(gone.ws, gone.c.id, { status: 'disconnected' });
    const ids = (await store.connectionsDueForReconcile(new Date(Date.now() - 600_000))).map(
      (r) => r.connectionId,
    );
    expect(ids).toContain(due.c.id);
    expect(ids).toContain(errored.c.id);
    expect(ids).not.toContain(fresh.c.id);
    expect(ids).not.toContain(gone.c.id);
  });
});
