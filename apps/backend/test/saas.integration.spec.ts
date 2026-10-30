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
const staffRequest = () => ({
  clientRequestId: newId(),
  kind: 'demo',
  name: 'Synthetic lead',
  email: 'lead@example.test',
  company: 'Synthetic Co',
  teamSize: '10-20',
});
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
  it('records staff requests idempotently, follows them up and enforces tenant and capability boundaries', async () => {
    const a = await owner(),
      b = await owner();
    const body = staffRequest();
    const created = await call(a.headers, 'POST', '/saas-requests', body);
    expect(created.statusCode).toBe(201);
    const row = created.json();
    expect(row).toMatchObject({ status: 'new', source: 'staff', kind: 'demo', version: 1 });
    expect((await call(a.headers, 'POST', '/saas-requests', body)).json().id).toBe(row.id);
    expect(
      (await call(a.headers, 'POST', '/saas-requests', { ...body, company: 'Other' })).statusCode,
    ).toBe(409);
    expect(
      (await call(a.headers, 'POST', '/saas-requests', { ...staffRequest(), email: null }))
        .statusCode,
    ).toBe(400);

    const contactId = await contact(a.headers);
    const moved = await call(a.headers, 'PATCH', `/saas-requests/${row.id}`, {
      version: 1,
      status: 'scheduled',
      contactId,
      preferredTime: 'Thứ 5, 15h',
    });
    expect(moved.statusCode).toBe(200);
    expect(moved.json()).toMatchObject({ status: 'scheduled', contactId, version: 2 });
    expect(
      (await call(a.headers, 'PATCH', `/saas-requests/${row.id}`, { version: 1, note: 'x' }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call(a.headers, 'PATCH', `/saas-requests/${row.id}`, {
          version: 2,
          status: 'converted',
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await call(a.headers, 'PATCH', `/saas-requests/${row.id}`, {
          version: 3,
          status: 'contacted',
        })
      ).statusCode,
    ).toBe(409);
    const list = (await call(a.headers, 'GET', '/saas-requests?status=converted')).json();
    expect(list.data.map((r: { id: string }) => r.id)).toEqual([row.id]);

    // Another business sees nothing, and cannot link someone else's customer.
    expect((await call(b.headers, 'GET', `/saas-requests/${row.id}`)).statusCode).toBe(404);
    expect((await call(b.headers, 'GET', '/saas-requests')).json().data).toEqual([]);
    expect(
      (await call(b.headers, 'POST', '/saas-requests', { ...staffRequest(), contactId }))
        .statusCode,
    ).toBe(404);
    const { db, close } = createDb({
      url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
      max: 2,
    });
    try {
      const seen = await withTenant(db, workspaceId(b.ws), (tx) =>
        tx.select().from(schema.saasRequests).where(eq(schema.saasRequests.id, row.id)),
      );
      expect(seen).toEqual([]);
    } finally {
      await close();
    }

    // A business of another industry has no SaaS screens.
    const shop = await owner('fashion');
    expect((await call(shop.headers, 'GET', '/saas-requests')).statusCode).toBe(404);

    // An analyst reads requests but cannot change them.
    await join(a, b, 'analyst');
    const analyst = { ...b.headers, 'x-workspace-id': a.ws };
    expect((await call(analyst, 'GET', '/saas-requests')).statusCode).toBe(200);
    expect((await call(analyst, 'POST', '/saas-requests', staffRequest())).statusCode).toBe(403);
    expect((await call({}, 'GET', '/saas-requests')).statusCode).toBe(401);
  });

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
    expect((await call(a.headers, 'PUT', path, subscription)).statusCode).toBe(409);
    expect(
      (await call(a.headers, 'PUT', path, { ...subscription, version: 1, stage: 'trial' }))
        .statusCode,
    ).toBe(400);

    const other = await contact(a.headers, '0983456722');
    await call(a.headers, 'PUT', `/contacts/${other}/saas-subscription`, {
      ...subscription,
      stage: 'trial',
      mrr: 0,
      trialEndsOn: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    });
    const summary = (await call(a.headers, 'GET', '/saas-subscriptions/summary')).json();
    expect(summary).toMatchObject({
      mrr: 990000,
      stages: { active: 1, trial: 1, past_due: 0, canceled: 0 },
      trialsEndingSoon: 1,
    });
    const list = (await call(a.headers, 'GET', '/saas-subscriptions?stage=active')).json();
    expect(list.data).toHaveLength(1);
    expect(list.data[0]).toMatchObject({ contactId, planName: 'Pro' });

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

  it('lets the bot create one request per conversation and kind, linked to the customer by phone', async () => {
    const a = await owner();
    const contactId = await contact(a.headers);
    const saas = app.get<SaasFacade>(SAAS_FACADE);
    const conversationId = newId();
    const ws = workspaceId(a.ws);
    const details = { name: 'Synthetic lead', phone: '+84 983 456 721', need: 'Quản lý bán hàng' };
    const first = await saas.recordBotRequest(ws, {
      conversationId,
      contactId: null,
      kind: 'trial',
      details,
      preview: false,
    });
    expect(first.outcome).toBe('created');
    expect(first.request).toMatchObject({ source: 'bot', contactId, conversationId });
    const [again, other] = await Promise.all([
      saas.recordBotRequest(ws, {
        conversationId,
        contactId: null,
        kind: 'trial',
        details: { ...details, teamSize: '8' },
        preview: false,
      }),
      saas.recordBotRequest(ws, {
        conversationId,
        contactId: null,
        kind: 'trial',
        details: { ...details, preferredTime: 'Sáng mai' },
        preview: false,
      }),
    ]);
    expect([again.outcome, other.outcome].sort()).toEqual(['updated', 'updated']);
    const rows = (await call(a.headers, 'GET', '/saas-requests')).json().data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ teamSize: '8', preferredTime: 'Sáng mai', version: 3 });
  });
});
