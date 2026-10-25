import {
  createDb,
  eq,
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
  facade = new ActionFacadeImpl(new DrizzleActionUnitOfWork(tenant), box, async () => ({
    ok: true,
    status: 200,
    json: { status: 'paid', secret: 'x' },
  }));
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

describe('pending confirmation atomicity on Postgres', () => {
  it('lets only one of several concurrent consumers take the pending call', async () => {
    const action = await facade.create(a, botA, input);
    const conv = newId();
    await facade.setPending(a, conv, { actionId: action.id, args: { code: '1' } });
    const taken = await Promise.all(
      Array.from({ length: 5 }, () => facade.consumePending(a, conv)),
    );
    expect(taken.filter(Boolean)).toHaveLength(1);
    expect(taken.find(Boolean)).toMatchObject({ args: { code: '1' } });
    expect(await facade.getPending(a, conv)).toBeNull();
    await facade.setPending(a, conv, { actionId: action.id, args: {} });
    expect(await facade.consumePending(b, conv)).toBeNull();
    expect(await facade.getPending(a, conv)).not.toBeNull();
  });
});

describe('runner persistence on Postgres', () => {
  const withResponse = {
    ...input,
    responses: [
      { statusCode: 200, fields: [{ name: 'status', type: 'string' as const, description: 's' }] },
    ],
  };

  it('records runs without args or body and hides them from other tenants', async () => {
    const action = await facade.create(a, botA, withResponse);
    const conversationId = newId();
    const out = await facade.invoke(a, botA, {
      actionId: action.id,
      args: { code: 'SECRET-CODE' },
      conversationId,
      idempotencyKey: 'k',
      isTest: false,
    });
    expect(out).toEqual({ ok: true, statusCode: 200, data: { status: 'paid' } });
    const test = await facade.test(a, botA, action.id, { code: 'SAMPLE-ARG' });
    expect(test.ok).toBe(true);
    const rows = (await owner.select().from(schema.actionRuns)).filter(
      (r) => r.actionId === action.id,
    );
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.isTest).sort()).toEqual([false, true]);
    // Markers must not occur by chance in ids or timestamps (an earlier "T1" matched "T15:…").
    expect(JSON.stringify(rows)).not.toMatch(/SECRET-CODE|SAMPLE-ARG|paid|tenant-a-token/);
    await withTenant(tenant, b, async (tx) => {
      expect(await tx.select().from(schema.actionRuns)).toEqual([]);
    });
    // Another workspace and another bot cannot execute it.
    expect(
      await facade.invoke(b, botB, {
        actionId: action.id,
        args: { code: 'x' },
        conversationId: null,
        idempotencyKey: 'k',
        isTest: false,
      }),
    ).toEqual({ ok: false, errorCode: 'not_found' });
  });

  it('keeps one pending call per conversation, expires it and isolates tenants', async () => {
    const action = await facade.create(a, botA, withResponse);
    const conv = newId();
    await facade.setPending(a, conv, { actionId: action.id, args: { code: '1' } });
    await facade.setPending(a, conv, { actionId: action.id, args: { code: '2' } });
    expect(await facade.getPending(a, conv)).toMatchObject({ args: { code: '2' } });
    expect(await facade.getPending(b, conv)).toBeNull();
    await expect(
      facade.setPending(b, conv, { actionId: action.id, args: {} }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await withTenant(tenant, a, (tx) =>
      tx
        .update(schema.actionPending)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(schema.actionPending.conversationId, conv)),
    );
    expect(await facade.getPending(a, conv)).toBeNull();
    await facade.setPending(a, conv, { actionId: action.id, args: {} });
    await facade.clearPending(b, conv);
    expect(await facade.getPending(a, conv)).not.toBeNull();
    await facade.clearPending(a, conv);
    expect(await facade.getPending(a, conv)).toBeNull();
  });
});
