import { AuthResponse, BootstrapResponse } from '@agent-sales/contracts';
import {
  createDb,
  ensureLoginRoles,
  migrate,
  schema,
  withCredentials,
  withTenant,
  eq,
} from '@agent-sales/db';
import { newId, userId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { SAAS_FACADE, type SaasFacade } from '../src/modules/saas/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../src/modules/workspace/api/index.js';

let pg: TestPostgres, app: NestFastifyApplication;
beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  app = (
    await createHttpApp(AppModule, {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
      DATABASE_SYSTEM_URL: withCredentials(
        pg.ownerUrl,
        pg.systemLogin.user,
        pg.systemLogin.password,
      ),
    })
  ).app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});
afterAll(async () => {
  await app?.close();
  await pg?.stop();
});

type Headers = Record<string, string>;
const call = (
  h: Headers,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  payload?: object,
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: '/api/v1' + path, headers: h, ...(payload ? { payload } : {}) });
let n = 0;
async function owner(industry = 'saas') {
  const i = ++n;
  const r = await app
    .getHttpAdapter()
    .getInstance()
    .inject({
      method: 'POST',
      url: '/api/v1/auth/signup',
      remoteAddress: `10.78.0.${i}`,
      payload: {
        name: 'Test owner',
        email: `saas-owner-${i}@example.test`,
        password: 'a long synthetic password',
        workspaceName: 'Synthetic software business',
        industry,
      },
    });
  expect(r.statusCode).toBe(201);
  const auth = AuthResponse.parse(r.json());
  const boot = BootstrapResponse.parse(
    (await call({ authorization: `Bearer ${auth.accessToken}` }, 'GET', '/bootstrap')).json(),
  );
  const ws = boot.memberships[0]?.workspaceId ?? '';
  return {
    userId: auth.user.id,
    ws,
    headers: { authorization: `Bearer ${auth.accessToken}`, 'x-workspace-id': ws },
  };
}
async function join(a: { ws: string; userId: string }, b: { userId: string }, role: string) {
  await app
    .get<WorkspaceFacade>(WORKSPACE_FACADE)
    .joinMember(workspaceId(a.ws), userId(b.userId), role as 'analyst', {
      seatLimit: null,
      actor: { userId: a.userId, name: 'Test owner' },
    });
}
async function contact(h: Headers, phone = '0983456721') {
  const r = await call(h, 'POST', '/contacts', { name: 'Synthetic customer', phone });
  expect(r.statusCode).toBe(201);
  return r.json().id as string;
}
/** Built-in status key of a customer (statuses are seeded per industry on first read). */
async function statusKey(h: Headers, contactId: string): Promise<string | null> {
  const statuses = (await call(h, 'GET', '/crm/statuses')).json() as {
    data: Array<{ id: string; key: string | null }>;
  };
  const { statusId } = (await call(h, 'GET', `/contacts/${contactId}`)).json();
  return statuses.data.find((o) => o.id === statusId)?.key ?? null;
}
const subscription = {
  version: null,
  planName: 'Pro',
  stage: 'active',
  billingPeriod: 'monthly',
  mrr: 990000,
  seats: 5,
  startedOn: '2026-10-01',
  renewsOn: '2026-11-01',
};

describe('saas HTTP and PostgreSQL isolation', () => {
  it('keeps one subscription per customer with MRR totals readable only with contacts.view_all', async () => {
    const a = await owner(),
      sales = await owner(),
      analyst = await owner();
    const contactId = await contact(a.headers);
    const path = `/contacts/${contactId}/saas-subscription`;
    expect((await call(a.headers, 'GET', path)).json()).toEqual({ subscription: null });
    const put = await call(a.headers, 'PUT', path, subscription);
    expect(put.statusCode).toBe(200);
    expect(put.json()).toMatchObject({ contactId, contactName: 'Synthetic customer', version: 1 });
    // The subscription decides the customer's status.
    expect(await statusKey(a.headers, contactId)).toBe('paying');
    expect((await call(a.headers, 'PUT', path, subscription)).statusCode).toBe(409);
    expect(
      (await call(a.headers, 'PUT', path, { ...subscription, version: 1, stage: 'trial' }))
        .statusCode,
    ).toBe(400);

    const other = await contact(a.headers, '0983456722');
    const trial = {
      ...subscription,
      stage: 'trial',
      mrr: 0,
      trialEndsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    };
    expect(
      (await call(a.headers, 'PUT', path, { ...subscription, version: 1, externalRef: 'acct-1' }))
        .statusCode,
    ).toBe(200);
    // An external reference belongs to one customer: reusing it is a conflict, not a server error.
    const reused = await call(a.headers, 'PUT', `/contacts/${other}/saas-subscription`, {
      ...trial,
      externalRef: 'acct-1',
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json()).toMatchObject({
      error: { code: 'CONFLICT', message: 'This external reference is already used' },
    });
    await call(a.headers, 'PUT', `/contacts/${other}/saas-subscription`, trial);
    expect(await statusKey(a.headers, other)).toBe('trial');
    const summary = (await call(a.headers, 'GET', '/saas-subscriptions/summary')).json();
    expect(summary).toMatchObject({
      mrr: 990000,
      stages: { active: 1, trial: 1, past_due: 0, canceled: 0 },
      trialsEndingSoon: 1,
    });
    const list = (await call(a.headers, 'GET', '/saas-subscriptions?stage=active')).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ contactId, planName: 'Pro' });
    const rows = (
      await call(a.headers, 'GET', `/saas-subscriptions?contactIds=${other},${newId()}`)
    ).json();
    expect(rows.data.map((r: { contactId: string }) => r.contactId)).toEqual([other]);
    const ending = (await call(a.headers, 'GET', '/saas-subscriptions?endingSoon=true')).json();
    expect(ending.data.map((r: { contactId: string }) => r.contactId)).toEqual([other]);

    // Another business sees nothing, also at the database level (forced RLS).
    const b = await owner();
    expect((await call(b.headers, 'GET', '/saas-subscriptions')).json().data).toEqual([]);
    expect((await call(b.headers, 'GET', path)).statusCode).toBe(404);
    const { db, close } = createDb({
      url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
      max: 2,
    });
    try {
      const seen = await withTenant(db, workspaceId(b.ws), (tx) =>
        tx
          .select()
          .from(schema.saasSubscriptions)
          .where(eq(schema.saasSubscriptions.contactId, contactId)),
      );
      expect(seen).toEqual([]);
    } finally {
      await close();
    }
    // A business of another industry has no SaaS screens.
    const shop = await owner('fashion');
    expect((await call(shop.headers, 'GET', '/saas-subscriptions')).statusCode).toBe(404);
    expect((await call({}, 'GET', '/saas-subscriptions')).statusCode).toBe(401);

    await join(a, sales, 'sales');
    await join(a, analyst, 'analyst');
    const asSales = { ...sales.headers, 'x-workspace-id': a.ws };
    const asAnalyst = { ...analyst.headers, 'x-workspace-id': a.ws };
    expect((await call(asSales, 'GET', '/saas-subscriptions/summary')).statusCode).toBe(403);
    expect((await call(asAnalyst, 'GET', '/saas-subscriptions/summary')).statusCode).toBe(200);
    expect((await call(asAnalyst, 'PUT', path, { ...subscription, version: 1 })).statusCode).toBe(
      403,
    );
  });

  it('lets the bot record a request on the customer: found or created by phone, moved forward, noted', async () => {
    const a = await owner();
    const saas = app.get<SaasFacade>(SAAS_FACADE);
    const ws = workspaceId(a.ws);
    const details = { name: 'Synthetic lead', phone: '+84 983 456 721', need: 'Quản lý bán hàng' };
    const first = await saas.recordBotRequest(ws, { kind: 'trial', details, preview: false });
    expect(first).toMatchObject({ outcome: 'recorded', created: true });
    const contactId = first.outcome === 'recorded' ? first.contactId : '';
    expect(await statusKey(a.headers, contactId)).toBe('requested');
    const again = await saas.recordBotRequest(ws, { kind: 'trial', details, preview: false });
    expect(again).toEqual({ outcome: 'recorded', contactId, created: false });
    const notes = (await call(a.headers, 'GET', `/contacts/${contactId}/notes`)).json().data;
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      authorName: 'Bot AI',
      body: 'Xin dùng thử (bot ghi nhận)\nNhu cầu: Quản lý bán hàng',
    });

    // A paying customer asking for a demo stays paying; the note still lands.
    const paying = await contact(a.headers, '0983456799');
    await call(a.headers, 'PUT', `/contacts/${paying}/saas-subscription`, subscription);
    const demo = await saas.recordBotRequest(ws, {
      kind: 'demo',
      details: { name: 'Synthetic customer', phone: '0983456799' },
      preview: false,
    });
    expect(demo).toEqual({ outcome: 'recorded', contactId: paying, created: false });
    expect(await statusKey(a.headers, paying)).toBe('paying');
    expect((await call(a.headers, 'GET', `/contacts/${paying}/notes`)).json().data[0].body).toBe(
      'Xin demo (bot ghi nhận)',
    );
  });
});
