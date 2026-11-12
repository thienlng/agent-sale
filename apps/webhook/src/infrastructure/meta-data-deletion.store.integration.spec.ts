import {
  createDb,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  sql,
  withCredentials,
} from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DrizzleMetaDataDeletionStore } from './meta-data-deletion.store.js';

/** Meta data deletion requests on a real Postgres, as the restricted system role. */
let pg: TestPostgres;
const handles: { close: () => Promise<void> }[] = [];
let owner: ReturnType<typeof createDb>['db'];
let tenant: ReturnType<typeof createDb>['db'];
let store: DrizzleMetaDataDeletionStore;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const o = createDb({ url: pg.ownerUrl, max: 1 });
  const s = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 2,
  });
  const t = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });
  handles.push(o, s, t);
  owner = o.db;
  tenant = t.db;
  store = new DrizzleMetaDataDeletionStore(s.db);
});

afterAll(async () => {
  for (const h of handles) await h.close();
  await pg?.stop();
});

const r = schema.metaDataDeletionRequests;

describe('DrizzleMetaDataDeletionStore', () => {
  it('stores one pending request per person, also when callbacks race', async () => {
    const hash = 'a'.repeat(64);
    const [a, b, c] = await Promise.all([
      store.request(hash),
      store.request(hash),
      store.request(hash),
    ]);
    expect(a.confirmationCode).toMatch(/^[0-9A-F]{24}$/);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(await owner.select().from(r).where(eq(r.userHash, hash))).toHaveLength(1);

    // Once completed (the hash is dropped), a new request from the same person gets a new code.
    await owner
      .update(r)
      .set({ status: 'completed', completedAt: new Date(), userHash: null })
      .where(eq(r.confirmationCode, a.confirmationCode));
    const next = await store.request(hash);
    expect(next.confirmationCode).not.toBe(a.confirmationCode);
  });

  it('keeps no hash on a completed request (checked by the table)', async () => {
    const { confirmationCode } = await store.request('b'.repeat(64));
    await expect(
      owner
        .update(r)
        .set({ status: 'completed', completedAt: new Date() })
        .where(eq(r.confirmationCode, confirmationCode)),
    ).rejects.toThrow();
  });

  it('is not readable by the tenant role', async () => {
    await expect(tenant.execute(sql`select * from meta_data_deletion_requests`)).rejects.toThrow();
  });
});
