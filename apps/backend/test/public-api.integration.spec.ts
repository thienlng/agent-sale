import { AuthResponse, BootstrapResponse, CreatedApiKey } from '@agent-sales/contracts';
import {
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
  type Database,
} from '@agent-sales/db';
import { newId, workspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import { SECRET_BOX, type SecretBox } from '../src/common/security/secret-box.js';
import {
  DEVELOPER_STORE,
  DEVELOPER_SYSTEM_STORE,
  type DeveloperStore,
  type DeveloperSystemStore,
} from '../src/modules/developer/application/ports/developer-store.js';
import { WebhookDispatcher } from '../src/modules/developer/application/webhook-dispatcher.js';
import { signUpVerified } from './support/signup.js';

/** ADR-022 end to end on Postgres: API keys through the guard, idempotency, webhook dispatch. */
let pg: TestPostgres,
  app: NestFastifyApplication,
  owner: { db: Database; close: () => Promise<void> };
beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  owner = createDb({ url: pg.ownerUrl, max: 2 });
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
  await owner?.close();
  await pg?.stop();
});

type Headers = Record<string, string>;
const call = (
  h: Headers,
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload?: object,
) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: '/api/v1' + path, headers: h, ...(payload ? { payload } : {}) });

let n = 0;
async function shop() {
  const i = ++n;
  const r = await signUpVerified(
    app,
    {
      name: 'Test owner',
      email: `api-owner-${i}@example.test`,
      password: 'a long synthetic password',
      workspaceName: 'Synthetic shop',
      industry: 'retail',
    },
    { remoteAddress: `10.79.0.${i}` },
  );
  expect(r.statusCode).toBe(201);
  const auth = AuthResponse.parse(r.json());
  const boot = BootstrapResponse.parse(
    (await call({ authorization: `Bearer ${auth.accessToken}` }, 'GET', '/bootstrap')).json(),
  );
  const ws = boot.memberships[0]?.workspaceId ?? '';
  return {
    ws,
    userId: auth.user.id,
    h: { authorization: `Bearer ${auth.accessToken}`, 'x-workspace-id': ws } as Headers,
  };
}

/** Grants the public API (an entitlement override, as an operator would). */
async function grant(ws: string, perMinute: number) {
  for (const [key, value] of [
    ['feature.public_api', true],
    ['api.requests_per_minute', perMinute],
  ] as const)
    await owner.db
      .insert(schema.workspaceEntitlementOverrides)
      .values({ workspaceId: ws, key, value, reason: 'test' })
      .onConflictDoUpdate({
        target: [
          schema.workspaceEntitlementOverrides.workspaceId,
          schema.workspaceEntitlementOverrides.key,
        ],
        set: { value },
      });
}

async function newKey(s: Awaited<ReturnType<typeof shop>>, scopes: string[]) {
  const r = await call(s.h, 'POST', '/api-keys', { name: 'Zapier', scopes });
  expect(r.statusCode, r.body).toBe(201);
  return CreatedApiKey.parse(r.json());
}

describe('public API keys', () => {
  it('needs the plan to create a key', async () => {
    const s = await shop();
    const r = await call(s.h, 'POST', '/api-keys', { name: 'Zapier', scopes: ['contacts.view'] });
    expect(r.statusCode).toBe(402);
  });

  it('calls apiKey routes as the creator, within scopes, and nothing else', async () => {
    const s = await shop();
    await grant(s.ws, 1000);
    const { key, apiKey } = await newKey(s, ['contacts.view', 'contacts.edit']);
    const k = { authorization: `Bearer ${key}` };

    const created = await call(k, 'POST', '/contacts', { name: 'Synthetic customer' });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.headers['x-ratelimit-limit']).toBe('1000');
    const contactId = (created.json() as { id: string }).id;
    expect((await call(k, 'GET', `/contacts/${contactId}`)).statusCode).toBe(200);
    // Not marked apiKey: 404 even for the dashboard settings of the same workspace.
    expect((await call(k, 'GET', '/members')).statusCode).toBe(404);
    expect((await call(k, 'GET', '/api-keys')).statusCode).toBe(404);
    // Outside the key's scopes.
    const orders = await call(k, 'GET', '/orders');
    expect([403, 404]).toContain(orders.statusCode);
    // Another workspace named in the header.
    const other = await shop();
    expect(
      (await call({ ...k, 'x-workspace-id': other.ws }, 'GET', `/contacts/${contactId}`))
        .statusCode,
    ).toBe(404);

    // The audit trail names the key.
    const [audit] = await owner.db
      .select({ actorName: schema.auditEvents.actorName })
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.targetId, contactId));
    if (audit) expect(audit.actorName).toBe('API: Zapier');

    const listed = await call(s.h, 'GET', '/api-keys');
    expect(
      (listed.json() as { data: { lastUsedAt: string | null }[] }).data[0]?.lastUsedAt,
    ).not.toBeNull();

    expect((await call(s.h, 'POST', `/api-keys/${apiKey.id}/revoke`)).statusCode).toBe(200);
    expect((await call(k, 'GET', `/contacts/${contactId}`)).statusCode).toBe(401);
  });

  it('replays an Idempotency-Key and refuses it for another body', async () => {
    const s = await shop();
    await grant(s.ws, 1000);
    const { key } = await newKey(s, ['contacts.view', 'contacts.edit']);
    const k = { authorization: `Bearer ${key}`, 'idempotency-key': `idem-${newId()}` };
    const a = await call(k, 'POST', '/contacts', { name: 'Once' });
    const b = await call(k, 'POST', '/contacts', { name: 'Once' });
    expect(a.statusCode, a.body).toBe(201);
    expect(b.statusCode).toBe(201);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.json()).toEqual(a.json());
    expect((await call(k, 'POST', '/contacts', { name: 'Twice' })).statusCode).toBe(422);
  });

  it('answers 429 with Retry-After past the per-minute limit', async () => {
    const s = await shop();
    await grant(s.ws, 2);
    const { key } = await newKey(s, ['contacts.view']);
    const k = { authorization: `Bearer ${key}` };
    await call(k, 'POST', '/contacts/query', {});
    await call(k, 'POST', '/contacts/query', {});
    const r = await call(k, 'POST', '/contacts/query', {});
    expect(r.statusCode).toBe(429);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    // The window lives in Postgres, so every API process counts the same requests.
    const [row] = await owner.db
      .select({ count: schema.apiKeys.rateWindowCount })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.workspaceId, s.ws));
    expect(row?.count).toBe(3);
  });

  it('serves the public OpenAPI document with apiKey routes only', async () => {
    const r = await call({}, 'GET', '/public/openapi.json');
    expect(r.statusCode).toBe(200);
    const paths = Object.keys((r.json() as { paths: Record<string, unknown> }).paths);
    expect(paths).toContain('/contacts');
    expect(paths).not.toContain('/api-keys');
    expect(paths).not.toContain('/members');
  });
});

describe('webhooks', () => {
  it('stores endpoints per workspace and dispatches committed public events once', async () => {
    const s = await shop();
    await grant(s.ws, 1000);
    const ws = workspaceId(s.ws);
    const store = app.get<DeveloperStore>(DEVELOPER_STORE);
    const box = app.get<SecretBox>(SECRET_BOX, { strict: false });
    // Inserted through the store: the HTTP create resolves the URL's DNS (no network in CI).
    const endpointId = newId();
    const now = new Date();
    await store.insertEndpoint({
      id: endpointId,
      workspaceId: ws,
      url: 'https://hooks.example.com/rapiz',
      description: '',
      events: ['crm.contact.created'],
      secretEncrypted: box.seal('whsec_test'),
      previousSecretEncrypted: null,
      previousSecretExpiresAt: null,
      enabled: true,
      disabledReason: null,
      failingSince: null,
      createdBy: s.userId as never,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    const list = await call(s.h, 'GET', '/webhook-endpoints');
    expect(list.statusCode).toBe(200);
    expect((list.json() as { data: { id: string }[] }).data.map((e) => e.id)).toEqual([endpointId]);
    const other = await shop();
    expect(
      (await call(other.h, 'GET', `/webhook-endpoints/${endpointId}/deliveries`)).statusCode,
    ).toBe(404);

    const dispatcher = app.get(WebhookDispatcher, { strict: false });
    await dispatcher.dispatch();
    const created = await call(s.h, 'POST', '/contacts', { name: 'Webhook customer' });
    expect(created.statusCode).toBe(201);
    expect(await dispatcher.dispatch()).toBe(1);
    expect(await dispatcher.dispatch()).toBe(0);

    const page = await call(s.h, 'GET', `/webhook-endpoints/${endpointId}/deliveries`);
    const [d] = (
      page.json() as {
        data: {
          id: string;
          eventType: string;
          status: string;
          payload: { data: Record<string, unknown> };
        }[];
      }
    ).data;
    expect(d).toMatchObject({ eventType: 'crm.contact.created', status: 'pending' });
    expect(d?.payload.data['contactId']).toBe((created.json() as { id: string }).id);

    // The sender's claim leases the row: a second claim does not see it.
    const system = app.get<DeveloperSystemStore>(DEVELOPER_SYSTEM_STORE);
    const claimed = await system.claimDue(new Date(Date.now() + 1000), 10, 60_000);
    expect(claimed.map((c) => c.delivery.id)).toContain(d?.id);
    expect(
      (await system.claimDue(new Date(Date.now() + 1000), 10, 60_000)).map((c) => c.delivery.id),
    ).not.toContain(d?.id);

    expect((await call(s.h, 'POST', `/webhook-deliveries/${d?.id ?? ''}/resend`)).statusCode).toBe(
      202,
    );
    expect((await call(s.h, 'DELETE', `/webhook-endpoints/${endpointId}`)).statusCode).toBe(204);
    const [gone] = await owner.db
      .select({ id: schema.webhookDeliveries.id })
      .from(schema.webhookDeliveries)
      .where(eq(schema.webhookDeliveries.endpointId, endpointId));
    expect(gone).toBeUndefined();
  });
});
