import { randomBytes } from 'node:crypto';

import {
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
  type Database,
} from '@agent-sales/db';
import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleKiotVietIngressStore } from './kiotviet-ingress.store.js';

/** KiotViet webhook persistence on a real Postgres, as the restricted system role. */
let pg: TestPostgres;
const handles: { close: () => Promise<void> }[] = [];
let owner: Database;
let store: DrizzleKiotVietIngressStore;
let userId: string;

/** One workspace per connection: only one live KiotViet connection is allowed per workspace. */
async function connection(
  status: schema.IntegrationConnectionStatus,
): Promise<{ id: string; token: string }> {
  const workspaceId = newId();
  await owner.insert(schema.workspaces).values({
    id: workspaceId,
    workspaceId,
    name: 'Shop',
    industry: 'retail',
    ownerUserId: userId,
  });
  const id = newId();
  const token = randomBytes(32).toString('base64url');
  await owner.insert(schema.integrationConnections).values({
    id,
    workspaceId,
    provider: 'kiotviet',
    status,
    retailer: 'shop',
    clientId: 'client',
    clientSecretSealed: 'sealed',
    webhookToken: token,
    webhookSecretSealed: 'sealed',
    settings: {},
  });
  return { id, token };
}

const stored = (connectionId: string) =>
  owner
    .select()
    .from(schema.integrationWebhookEvents)
    .where(eq(schema.integrationWebhookEvents.connectionId, connectionId));

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const o = createDb({ url: pg.ownerUrl, max: 1 });
  const s = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  handles.push(o, s);
  owner = o.db;
  store = new DrizzleKiotVietIngressStore(s.db);
  userId = newId();
  await owner
    .insert(schema.users)
    .values({ id: userId, email: `${userId}@example.test`, name: 'O' });
});

afterAll(async () => {
  for (const h of handles) await h.close();
  await pg?.stop();
});

describe('DrizzleKiotVietIngressStore', () => {
  it('stores a delivery once with its raw body and signature', async () => {
    const c = await connection('connected');
    const body = '{ "Id":"d-1", "Notifications":[] }';
    const delivery = { deliveryId: 'd-1', body, signature: 'sig' };
    expect(await store.store(c.token, delivery)).toBe('stored');
    expect(await store.store(c.token, delivery)).toBe('duplicate');
    const rows = await stored(c.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ deliveryId: 'd-1', body, signature: 'sig', processedAt: null });
  });

  it('keeps ingesting while syncing or in error, but not after disconnect', async () => {
    const syncing = await connection('syncing');
    const failed = await connection('error');
    const gone = await connection('disconnected');
    const d = { deliveryId: 'd-2', body: '{}', signature: null };
    expect(await store.store(syncing.token, d)).toBe('stored');
    expect(await store.store(failed.token, d)).toBe('stored');
    expect(await store.store(gone.token, d)).toBe('unknown');
    expect(await stored(gone.id)).toHaveLength(0);
  });

  it('answers unknown for a token nobody owns', async () => {
    const d = { deliveryId: 'd-3', body: '{}', signature: null };
    expect(await store.store(randomBytes(32).toString('base64url'), d)).toBe('unknown');
  });
});
