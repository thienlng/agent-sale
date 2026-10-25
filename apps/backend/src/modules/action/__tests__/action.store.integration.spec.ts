import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  withCredentials,
  withSystem,
  withTenant,
  type Database,
} from '@agent-sales/db';
import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ActionFacadeImpl } from '../application/action.facade.impl.js';
import { DrizzleActionUnitOfWork } from '../infrastructure/action.unit-of-work.js';
import { SecretBox } from '../../../common/security/secret-box.js';

/** Forced RLS on the three action tables and the Drizzle CRUD on a real Postgres. */
let pg: TestPostgres;
const handles: { close: () => Promise<void> }[] = [];
let tenant: Database;
let owner: Database;
let facade: ActionFacadeImpl;
let a: WorkspaceId;
let b: WorkspaceId;
const botA = newId();
const botB = newId();
const box = SecretBox.insecureDevelopmentBox();

function open(url: string, max = 1): Database {
  const h = createDb({ url, max });
  handles.push(h);
  return h.db;
}

const input = {
  name: 'Order lookup',
  description: 'Look up an order by code.',
  url: 'https://shop.example.com/api/orders/{code}',
  method: 'GET' as const,
  params: [
    {
      name: 'code',
      type: 'string' as const,
      location: 'path' as const,
      required: true,
      description: 'Order code',
    },
  ],
  responses: [],
  auth: { kind: 'bearer' as const },
  authSecret: 'tenant-a-token',
  requiresConfirm: false,
  enabled: true,
};

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const tenantUrl = withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password);
  const systemUrl = withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password);
  owner = open(pg.ownerUrl);
  tenant = open(tenantUrl, 2);
  const system = open(systemUrl);
  facade = new ActionFacadeImpl(new DrizzleActionUnitOfWork(tenant), box);
  a = workspaceId(newId());
  b = workspaceId(newId());
  for (const [ws, bot] of [
    [a, botA],
    [b, botB],
  ] as const) {
    const id = userId(newId());
    await withSystem(system, (tx) =>
      tx.insert(schema.users).values({ id, email: `${id}@example.test`, name: 'Owner' }),
    );
    await withTenant(tenant, ws, async (tx) => {
      await tx.insert(schema.workspaces).values({
        id: ws,
        workspaceId: ws,
        name: 'Shop',
        industry: 'retail',
        ownerUserId: id,
      });
      await tx
        .insert(schema.bots)
        .values({ id: bot, workspaceId: ws, name: 'Bot', industry: 'retail', settings: {} });
    });
  }
});

afterAll(async () => {
  for (const h of handles) await h.close();
  await pg?.stop();
});

describe('bot_actions on Postgres', () => {
  it('round-trips an action and seals the secret in the column', async () => {
    const dto = await facade.create(a, botA, input);
    expect(dto).toMatchObject({ name: 'Order lookup', hasSecret: true, auth: { kind: 'bearer' } });
    expect(await facade.get(a, botA, dto.id)).toEqual(dto);
    const [row] = await owner.select().from(schema.botActions);
    expect(row?.authSecretEnc).toBeTruthy();
    expect(row?.authSecretEnc).not.toContain('tenant-a-token');
    expect(box.open(row?.authSecretEnc ?? '')).toBe('tenant-a-token');
    const updated = await facade.update(a, botA, dto.id, { name: 'Renamed', authSecret: '' });
    expect(updated).toMatchObject({ name: 'Renamed', hasSecret: false });
    await facade.remove(a, botA, dto.id);
    expect(await facade.list(a, botA)).toEqual([]);
  });

  it('is invisible and immutable for another workspace', async () => {
    const dto = await facade.create(a, botA, input);
    expect(await facade.list(b, botA)).toEqual([]);
    await expect(facade.get(b, botA, dto.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(facade.update(b, botA, dto.id, { name: 'x' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(facade.remove(b, botA, dto.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await facade.get(a, botA, dto.id)).name).toBe('Order lookup');
  });
});

describe('forced RLS on the three action tables', () => {
  it('hides rows and rejects writes into another workspace', async () => {
    const action = await facade.create(a, botA, input);
    const conversationId = newId();
    await withTenant(tenant, a, async (tx) => {
      await tx.insert(schema.actionRuns).values({
        id: newId(),
        workspaceId: a,
        actionId: action.id,
        conversationId,
        statusCode: 200,
        ok: true,
        latencyMs: 12,
      });
      await tx.insert(schema.actionPending).values({
        conversationId,
        workspaceId: a,
        actionId: action.id,
        args: { code: 'A1' },
        expiresAt: new Date(Date.now() + 600_000),
      });
    });
    await withTenant(tenant, b, async (tx) => {
      expect(await tx.select().from(schema.botActions)).toEqual([]);
      expect(await tx.select().from(schema.actionRuns)).toEqual([]);
      expect(await tx.select().from(schema.actionPending)).toEqual([]);
    });
    await withTenant(tenant, a, async (tx) => {
      expect(await tx.select().from(schema.actionRuns)).toHaveLength(1);
      expect(await tx.select().from(schema.actionPending)).toHaveLength(1);
    });
    // B cannot plant rows that claim to belong to A.
    await expect(
      withTenant(tenant, b, (tx) =>
        tx.insert(schema.actionRuns).values({
          id: newId(),
          workspaceId: a,
          actionId: action.id,
          ok: false,
          latencyMs: 1,
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(tenant, b, (tx) =>
        tx.insert(schema.botActions).values({
          id: newId(),
          workspaceId: a,
          botId: botA,
          name: 'x',
          description: 'x',
          url: 'https://x.example.com',
          method: 'GET',
        }),
      ),
    ).rejects.toThrow();
  });

  it('cascades runs and pending away when the action is deleted', async () => {
    const action = await facade.create(a, botA, input);
    await withTenant(tenant, a, (tx) =>
      tx.insert(schema.actionPending).values({
        conversationId: newId(),
        workspaceId: a,
        actionId: action.id,
        args: {},
        expiresAt: new Date(),
      }),
    );
    await facade.remove(a, botA, action.id);
    const left = await owner.select().from(schema.actionPending);
    expect(left.filter((p) => p.actionId === action.id)).toEqual([]);
  });
});
