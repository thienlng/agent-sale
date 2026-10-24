import type { NormalizedEvent } from '@agent-sales/channels';
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

import { MetaIngressStore } from './meta-ingress.store.js';

/** Webhook persistence on a real Postgres, as the restricted system role. */
let pg: TestPostgres;
const handles: { close: () => Promise<void> }[] = [];
let owner: Database;
let store: MetaIngressStore;
const workspaceId = newId();

function event(page: string, id: string): NormalizedEvent {
  return {
    kind: 'facebook',
    assetExternalId: page,
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: 'customer',
    type: 'message',
    occurredAt: new Date(),
    text: 'hi',
    raw: { secret: 'raw payload is not stored' },
  };
}

async function page(externalId: string, status: string): Promise<string> {
  const id = newId();
  await owner.insert(schema.channelConnections).values({
    id,
    workspaceId,
    provider: 'facebook',
    externalId,
    name: externalId,
    status,
    tokenSealed: 'sealed',
  });
  return id;
}

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
  store = new MetaIngressStore(s.db);
  const userId = newId();
  await owner
    .insert(schema.users)
    .values({ id: userId, email: `${userId}@example.test`, name: 'O' });
  await owner.insert(schema.workspaces).values({
    id: workspaceId,
    workspaceId,
    name: 'Shop',
    industry: 'retail',
    ownerUserId: userId,
  });
});

afterAll(async () => {
  for (const h of handles) await h.close();
  await pg?.stop();
});

const stored = (connectionId: string) =>
  owner
    .select()
    .from(schema.channelWebhookEvents)
    .where(eq(schema.channelWebhookEvents.connectionId, connectionId));

describe('MetaIngressStore', () => {
  it('stores an event once, without the raw payload', async () => {
    const id = await page('page-ok', 'connected');
    expect(await store.storeOnce('facebook', 'e1', {}, event('page-ok', 'e1'))).toBe(true);
    expect(await store.storeOnce('facebook', 'e1', {}, event('page-ok', 'e1'))).toBe(false);
    const rows = await stored(id);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0]?.payload)).not.toContain('raw payload is not stored');
  });

  it('keeps ingesting while the page awaits re-auth, but not after disconnect', async () => {
    const reauth = await page('page-reauth', 'reauth_required');
    const gone = await page('page-gone', 'disconnected');
    expect(await store.storeOnce('facebook', 'e2', {}, event('page-reauth', 'e2'))).toBe(true);
    expect(await store.storeOnce('facebook', 'e3', {}, event('page-gone', 'e3'))).toBe(false);
    expect(await stored(reauth)).toHaveLength(1);
    expect(await stored(gone)).toHaveLength(0);
  });

  it('ignores events for pages nobody connected', async () => {
    expect(await store.storeOnce('facebook', 'e4', {}, event('page-unknown', 'e4'))).toBe(false);
  });
});
