import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import { bots, trainingHistory, trainingItems, users, workspaces } from './schema/index.js';
import { withSystem, withTenant } from './tenant.js';

let pg: TestPostgres;
let tenant: { db: Database; close: () => Promise<void> };
let system: { db: Database; close: () => Promise<void> };
let a: WorkspaceId;
let b: WorkspaceId;
const botId = newId();
beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  tenant = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });
  system = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  a = workspaceId(newId());
  b = workspaceId(newId());
  for (const ws of [a, b]) {
    const owner = userId(newId());
    await withSystem(system.db, (tx) =>
      tx.insert(users).values({ id: owner, email: `${owner}@example.test`, name: 'Owner' }),
    );
    await withTenant(tenant.db, ws, (tx) =>
      tx.insert(workspaces).values({
        id: ws,
        workspaceId: ws,
        name: 'Training workspace',
        industry: 'retail',
        ownerUserId: owner,
      }),
    );
  }
  await withTenant(tenant.db, a, (tx) =>
    tx.insert(bots).values({
      id: botId,
      workspaceId: a,
      name: 'Training bot',
      industry: 'retail',
      settings: {},
    }),
  );
});
afterAll(async () => {
  await tenant?.close();
  await system?.close();
  await pg?.stop();
});

describe('Training forced RLS', () => {
  it('hides materials/history and rejects writes into another workspace', async () => {
    const itemId = newId();
    await withTenant(tenant.db, a, async (tx) => {
      await tx.insert(trainingItems).values({
        id: itemId,
        workspaceId: a,
        botId,
        kind: 'scenario',
        title: 'Returns',
        content: 'Ask for an order number.',
      });
      await tx.insert(trainingHistory).values({
        id: newId(),
        workspaceId: a,
        botId,
        itemId,
        title: 'Returns',
        kind: 'scenario',
        action: 'created',
      });
    });
    expect(await withTenant(tenant.db, a, (tx) => tx.select().from(trainingItems))).toHaveLength(1);
    expect(await withTenant(tenant.db, b, (tx) => tx.select().from(trainingItems))).toEqual([]);
    expect(await withTenant(tenant.db, b, (tx) => tx.select().from(trainingHistory))).toEqual([]);
    await expect(
      withTenant(tenant.db, b, (tx) =>
        tx.insert(trainingItems).values({
          id: newId(),
          workspaceId: a,
          botId,
          kind: 'scenario',
          title: 'Leak',
          content: 'Forbidden',
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenant.db, b, (tx) =>
        tx.insert(trainingHistory).values({
          id: newId(),
          workspaceId: a,
          botId,
          itemId,
          title: 'Leak',
          kind: 'faq',
          action: 'updated',
        }),
      ),
    ).rejects.toThrow();
  });
});
