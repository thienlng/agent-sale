import { copyFile, mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { newId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, MIGRATIONS_DIR, withCredentials } from './migrate.js';
import { withSystem } from './tenant.js';

/** Upgrading an install that already has shops across the billing migrations (T-064). */
let pg: TestPostgres;
let ownerDb: { db: Database; close: () => Promise<void> };
let systemDb: { db: Database; close: () => Promise<void> };

/** A copy of the migrations up to and including `last`. */
async function migrationsUpTo(last: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
  for (const f of await readdir(MIGRATIONS_DIR))
    if (f <= last) await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
  return dir;
}

async function shop(): Promise<string> {
  const owner = newId();
  const ws = newId();
  await ownerDb.db.execute(
    sql`insert into users (id, email, name) values (${owner}, ${`${owner}@example.test`}, 'Owner')`,
  );
  await ownerDb.db
    .execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
    values (${ws}, ${ws}, 'Shop', 'retail', ${owner})`);
  return ws;
}

/** The Postgres error code behind a failed query (drizzle wraps it). */
const pgCode = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { cause?: { code?: string } }) => e.cause?.code ?? null,
  );

const seatOverride = async (ws: string) =>
  (
    await ownerDb.db.execute<{ value: unknown }>(
      sql`select value from workspace_entitlement_overrides
          where workspace_id = ${ws} and key = 'members.max'`,
    )
  )[0];

let before: string;
let after: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  ownerDb = createDb({ url: pg.ownerUrl, max: 1 });
  await migrate(pg.ownerUrl, await migrationsUpTo('0014_team_access.sql'));
  before = await shop();
  await migrate(pg.ownerUrl, await migrationsUpTo('0019_billing_tenant_read_only.sql'));
  after = await shop();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  systemDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
});

afterAll(async () => {
  await Promise.all([ownerDb?.close(), systemDb?.close()]);
  await pg?.stop();
});

describe('upgrading across billing (T-064)', () => {
  it('keeps shops from before billing without a member limit; later shops start on free', async () => {
    expect(await seatOverride(before)).toEqual({ value: null });
    expect(await seatOverride(after)).toBeUndefined();
  });

  it('the system role can add audit events but not rewrite or delete them', async () => {
    const id = newId();
    await withSystem(systemDb.db, (tx) =>
      tx.execute(sql`insert into audit_events (id, workspace_id, action, target_type)
        values (${id}, ${before}, 'test.added', 'test')`),
    );
    const insufficientPrivilege = '42501';
    expect(
      await pgCode(
        withSystem(systemDb.db, (tx) =>
          tx.execute(sql`update audit_events set action = 'test.changed' where id = ${id}`),
        ),
      ),
    ).toBe(insufficientPrivilege);
    expect(
      await pgCode(
        withSystem(systemDb.db, (tx) => tx.execute(sql`delete from audit_events where id = ${id}`)),
      ),
    ).toBe(insufficientPrivilege);
  });
});
