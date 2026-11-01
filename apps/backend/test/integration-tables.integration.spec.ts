import {
  createDb,
  type Database,
  ensureLoginRoles,
  migrate,
  schema,
  withCredentials,
  withSystem,
  withTenant,
} from '@agent-sales/db';
import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** PMS integration tables (0040, ADR-017): row-level tenant isolation and link-column keys. */
let pg: TestPostgres;
let tenant: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };
let a: WorkspaceId;
let b: WorkspaceId;
const connectionOf = new Map<WorkspaceId, string>();

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

  a = workspaceId(newId());
  b = workspaceId(newId());
  for (const ws of [a, b]) {
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
    const connectionId = newId();
    connectionOf.set(ws, connectionId);
    await withTenant(tenant.db, ws, async (tx) => {
      await tx.insert(schema.integrationConnections).values(connection(ws, connectionId));
      await tx.insert(schema.integrationJobs).values({
        id: newId(),
        workspaceId: ws,
        connectionId,
        kind: 'full_import',
      });
      await tx.insert(schema.integrationWebhookEvents).values({
        id: newId(),
        workspaceId: ws,
        connectionId,
        deliveryId: `delivery-${ws}`,
        body: '{}',
      });
      await tx.insert(schema.integrationImageCache).values({
        workspaceId: ws,
        sourceUrl: 'https://cdn.kiotviet.test/p.jpg',
        storedUrl: `https://media.rapiz.test/${ws}/p.jpg`,
      });
      await tx.insert(schema.integrationSyncLog).values({
        id: newId(),
        workspaceId: ws,
        connectionId,
        level: 'info',
        code: 'sync.started',
      });
    });
  }
});

afterAll(async () => {
  await Promise.all([tenant?.close(), system?.close()]);
  await pg?.stop();
});

function connection(ws: WorkspaceId, id: string, webhookToken = `token-${id}`) {
  return {
    id,
    workspaceId: ws,
    provider: 'kiotviet' as const,
    status: 'connected' as const,
    retailer: 'shoplan',
    clientId: 'client',
    clientSecretSealed: 'sealed-secret',
    webhookToken,
    webhookSecretSealed: 'sealed-webhook-secret',
    settings: {},
  };
}

/** Postgres error code of a rejected statement (drizzle wraps the driver error in `cause`). */
async function pgCode(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
  } catch (error) {
    const e = error as { code?: string; cause?: { code?: string } };
    return e.cause?.code ?? e.code;
  }
  return undefined;
}

describe('integration tables on Postgres', () => {
  it('each tenant reads only its own rows in every integration table', async () => {
    for (const [mine, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const seen = await withTenant(tenant.db, mine, async (tx) => ({
        connections: await tx.select().from(schema.integrationConnections),
        jobs: await tx.select().from(schema.integrationJobs),
        events: await tx.select().from(schema.integrationWebhookEvents),
        images: await tx.select().from(schema.integrationImageCache),
        log: await tx.select().from(schema.integrationSyncLog),
      }));
      for (const rows of Object.values(seen)) {
        expect(rows.length).toBe(1);
        expect(rows.map((r) => r.workspaceId)).toEqual([mine]);
        expect(rows.map((r) => r.workspaceId)).not.toContain(other);
      }
    }
  });

  it('rejects writing a row into another workspace', async () => {
    const code = await pgCode(() =>
      withTenant(tenant.db, a, (tx) =>
        tx.insert(schema.integrationSyncLog).values({
          id: newId(),
          workspaceId: b,
          connectionId: connectionOf.get(b) ?? '',
          level: 'error',
          code: 'sync.failed',
        }),
      ),
    );
    expect(code).toBe('42501');
  });

  it('keeps webhook tokens unique across workspaces', async () => {
    const [first] = await withTenant(tenant.db, a, (tx) =>
      tx.select().from(schema.integrationConnections),
    );
    // A disconnected row frees the per-workspace slot but never the global token.
    const code = await pgCode(() =>
      withTenant(tenant.db, b, (tx) =>
        tx.insert(schema.integrationConnections).values({
          ...connection(b, newId(), first?.webhookToken),
          status: 'disconnected',
        }),
      ),
    );
    expect(code).toBe('23505');
  });

  it('allows one live connection per provider and workspace', async () => {
    const code = await pgCode(() =>
      withTenant(tenant.db, a, (tx) =>
        tx.insert(schema.integrationConnections).values(connection(a, newId())),
      ),
    );
    expect(code).toBe('23505');
  });

  it('links a catalog product to one external id per source', async () => {
    const product = (id: string) => ({
      id,
      workspaceId: a,
      code: `SP-${id.slice(-6)}`,
      name: 'Áo thun',
      searchText: 'ao thun',
      externalSource: 'kiotviet',
      externalId: '1001',
    });
    await withTenant(tenant.db, a, (tx) => tx.insert(schema.products).values(product(newId())));
    const code = await pgCode(() =>
      withTenant(tenant.db, a, (tx) => tx.insert(schema.products).values(product(newId()))),
    );
    expect(code).toBe('23505');
  });
});
