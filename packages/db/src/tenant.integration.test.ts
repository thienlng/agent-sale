import { newId, userId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import { llmProviders, llmTierRoutes, members, users, workspaces } from './schema/index.js';
import { sql } from 'drizzle-orm';
import { withSystem, withTenant } from './tenant.js';

/**
 * Proves ADR-004 against a real Postgres. Each client uses ONE connection
 * (`max: 1`) so every transaction reuses the same physical session — exactly
 * what PgBouncer transaction pooling does. A session-scoped `SET` would leak
 * between these transactions; `set_config(..., true)` must not.
 */
let pg: TestPostgres;
let tenantDb: { db: Database; close: () => Promise<void> };
let systemDb: { db: Database; close: () => Promise<void> };
let ownerDb: { db: Database; close: () => Promise<void> };
let a: WorkspaceId;
let b: WorkspaceId;

beforeAll(async () => {
  pg = await startTestPostgres();
  const first = await migrate(pg.ownerUrl);
  expect(first.applied.length).toBeGreaterThan(0);
  const second = await migrate(pg.ownerUrl);
  expect(second.applied).toEqual([]);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });

  tenantDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });
  systemDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  ownerDb = createDb({ url: pg.ownerUrl, max: 1 });

  a = workspaceId(newId());
  b = workspaceId(newId());
  for (const ws of [a, b]) {
    const owner = userId(newId());
    await withSystem(systemDb.db, (tx) =>
      tx.insert(users).values({ id: owner, email: `${owner}@example.test`, name: 'Owner' }),
    );
    await withTenant(tenantDb.db, ws, async (tx) => {
      await tx.insert(workspaces).values({
        id: ws,
        workspaceId: ws,
        name: `ws-${ws.slice(-4)}`,
        industry: 'retail',
        ownerUserId: owner,
      });
      await tx
        .insert(members)
        .values({ id: newId(), workspaceId: ws, userId: owner, role: 'owner' });
    });
  }
});

afterAll(async () => {
  await Promise.all([tenantDb?.close(), systemDb?.close(), ownerDb?.close()]);
  await pg?.stop();
});

describe('tenant isolation (ADR-004)', () => {
  it('each tenant sees only its own rows, alternating on one reused connection', async () => {
    for (let i = 0; i < 3; i++) {
      for (const [mine, other] of [
        [a, b],
        [b, a],
      ] as const) {
        const rows = await withTenant(tenantDb.db, mine, (tx) => tx.select().from(workspaces));
        expect(rows.map((r) => r.id)).toEqual([mine]);
        expect(rows.map((r) => r.id)).not.toContain(other);
      }
    }
  });

  it('a transaction without tenant context sees nothing (context does not leak)', async () => {
    await withTenant(tenantDb.db, a, (tx) => tx.select().from(workspaces));
    const rows = await tenantDb.db.transaction((tx) => tx.select().from(workspaces));
    expect(rows).toEqual([]);
  });

  it('a tenant cannot write a row for another workspace', async () => {
    await expect(
      withTenant(tenantDb.db, a, (tx) =>
        tx.insert(members).values({ id: newId(), workspaceId: b, userId: newId(), role: 'sale' }),
      ),
    ).rejects.toThrow();
  });

  it('a tenant connection cannot escalate by setting a GUC', async () => {
    const rows = await tenantDb.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.role', 'system', true)`);
      return tx.select().from(workspaces);
    });
    expect(rows).toEqual([]);
  });

  it('identity tables are not readable by tenant connections', async () => {
    await expect(withTenant(tenantDb.db, a, (tx) => tx.select().from(users))).rejects.toThrow();
  });

  it('platform LLM configuration is not readable by tenant connections', async () => {
    await expect(
      withTenant(tenantDb.db, a, (tx) => tx.select().from(llmProviders)),
    ).rejects.toThrow();
    await expect(
      withTenant(tenantDb.db, a, (tx) => tx.select().from(llmTierRoutes)),
    ).rejects.toThrow();
    await expect(withSystem(systemDb.db, (tx) => tx.select().from(llmProviders))).resolves.toEqual(
      [],
    );
  });

  it('the system role reads across tenants', async () => {
    const rows = await withSystem(systemDb.db, (tx) => tx.select().from(workspaces));
    expect(rows.map((r) => r.id).sort()).toEqual([a, b].sort());
  });

  it('every table with a workspace_id column has RLS enabled and forced', async () => {
    // Superusers bypass RLS even when forced (Postgres semantics), so the owner
    // login is used only for migrations; apps never connect as a superuser.
    const rows = await ownerDb.db.execute<{ table: string; rls: boolean; forced: boolean }>(sql`
      select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced
      from pg_class c
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'workspace_id' and not a.attisdropped
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      where c.relkind = 'r' and c.relname not in ('tenant_routes', 'outbox_events')`);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows)
      expect({ table: r.table, rls: r.rls, forced: r.forced }).toEqual({
        table: r.table,
        rls: true,
        forced: true,
      });
  });

  it('refuses a migration that was edited after being applied', async () => {
    const { mkdtemp, writeFile, copyFile, readdir } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const path = await import('node:path');
    const { MIGRATIONS_DIR } = await import('./migrate.js');
    const dir = await mkdtemp(path.join(tmpdir(), 'mig-'));
    for (const f of await readdir(MIGRATIONS_DIR))
      await copyFile(path.join(MIGRATIONS_DIR, f), path.join(dir, f));
    await writeFile(path.join(dir, '0000_init.sql'), '-- edited\nselect 1;');
    await expect(migrate(pg.ownerUrl, dir)).rejects.toThrow('modified after being applied');
  });
});
