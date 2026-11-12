import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';
import { PURGE_RETAINED_TABLES, purgeWorkspaceRows, workspacePurgeOrder } from './purge.js';
import { withSystem } from './tenant.js';

/**
 * Business purge (ADR-032) on the real schema: catalog coverage (every table with `workspace_id`
 * is purged or deliberately retained, and app_system may delete from it), foreign-key order,
 * batches that resume, and tenant isolation (another business keeps every row).
 */
let pg: TestPostgres;
let systemDb: { db: Database; close: () => Promise<void> };
let ownerDb: { db: Database; close: () => Promise<void> };
const a: WorkspaceId = workspaceId(newId());
const b: WorkspaceId = workspaceId(newId());

async function count(table: string, ws: WorkspaceId): Promise<number> {
  const rows = await ownerDb.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)} where workspace_id = ${ws}`,
  );
  return Number(rows[0]?.n ?? 0);
}

async function tablesWithWorkspaceId(): Promise<string[]> {
  const rows = await ownerDb.db.execute<{ name: string }>(sql`
    select c.relname as name from pg_attribute a
    join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and a.attname = 'workspace_id' and not a.attisdropped
      and c.relkind in ('r', 'p') and not c.relispartition
    order by 1`);
  return rows.map((r) => r.name);
}

async function seed(ws: WorkspaceId, owner: string): Promise<void> {
  const db = ownerDb.db;
  await db.execute(sql`insert into workspaces (id, workspace_id, name, industry, owner_user_id)
    values (${ws}, ${ws}, 'Shop', 'fashion', ${owner})`);
  await db.execute(sql`insert into members (id, workspace_id, user_id, role)
    values (${newId()}, ${ws}, ${owner}, 'owner')`);
  for (let i = 0; i < 5; i++) {
    const contact = newId();
    await db.execute(
      sql`insert into contacts (id, workspace_id, name) values (${contact}, ${ws}, ${`C${i}`})`,
    );
    await db.execute(sql`insert into contact_notes (id, workspace_id, contact_id, body)
      values (${newId()}, ${ws}, ${contact}, 'note')`);
  }
  // A self-referencing table whose foreign key does not cascade (parents and children).
  const root = newId();
  await db.execute(
    sql`insert into purge_tree_probe (id, workspace_id, parent_id) values (${root}, ${ws}, null)`,
  );
  for (let i = 0; i < 4; i++) {
    await db.execute(sql`insert into purge_tree_probe (id, workspace_id, parent_id)
      values (${newId()}, ${ws}, ${root})`);
  }
  await db.execute(sql`insert into tenant_routes (workspace_id) values (${ws})`);
  await db.execute(sql`insert into outbox_events (workspace_id, type, aggregate_type, aggregate_id, payload)
    values (${ws}, 'test.thing.done.v1', 'thing', ${newId()}, '{}'::jsonb)`);
  await db.execute(sql`insert into audit_events (id, workspace_id, action, target_type)
    values (${newId()}, ${ws}, 'test.done', 'thing')`);
  const account = newId();
  await db.execute(sql`insert into accounts (id, name, created_by_user_id)
    values (${account}, 'Account', ${owner})`);
  await db.execute(sql`insert into message_usage (account_id, workspace_id, idempotency_key, cycle_start, status)
    values (${account}, ${ws}, ${newId()}, now(), 'captured')`);
}

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, {
    tenant: pg.tenantLogin,
    system: pg.systemLogin,
    assistantSql: pg.assistantSqlLogin,
  });
  systemDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
    max: 1,
  });
  ownerDb = createDb({ url: pg.ownerUrl, max: 1 });
  await ownerDb.db.execute(sql`
    create table purge_tree_probe (id uuid primary key, workspace_id uuid not null references workspaces(id),
      parent_id uuid references purge_tree_probe(id));
    alter table purge_tree_probe enable row level security;
    alter table purge_tree_probe force row level security;
    create policy purge_tree_probe_system on purge_tree_probe for all to app_system using (true) with check (true);
    grant select, delete on purge_tree_probe to app_system;`);
  const owner = newId();
  await ownerDb.db.execute(
    sql`insert into users (id, email, name) values (${owner}, ${`${owner}@x.test`}, 'Owner')`,
  );
  await seed(a, owner);
  await seed(b, owner);
});

afterAll(async () => {
  await Promise.all([systemDb?.close(), ownerDb?.close()]);
  await pg?.stop();
});

describe('workspace purge', () => {
  it('covers every table with workspace_id except the retained ones, parents after children', async () => {
    const order = await withSystem(systemDb.db, (tx) => workspacePurgeOrder(tx));
    const names = order.map((t) => t.name);
    const all = await tablesWithWorkspaceId();
    expect([...names].sort()).toEqual(all.filter((t) => !PURGE_RETAINED_TABLES.includes(t)));
    for (const retained of PURGE_RETAINED_TABLES) expect(all).toContain(retained);
    expect(names.indexOf('contact_notes')).toBeLessThan(names.indexOf('contacts'));
    expect(names.indexOf('order_items')).toBeLessThan(names.indexOf('orders'));
    expect(order.find((t) => t.name === 'purge_tree_probe')?.singleStatement).toBe(true);
  });

  it('lets the system role delete from every purged table', async () => {
    const order = await withSystem(systemDb.db, (tx) => workspacePurgeOrder(tx));
    const denied = await ownerDb.db.execute<{ name: string }>(sql`
      select t as name from unnest(string_to_array(${order.map((x) => x.name).join(',')}, ',')) t
      where not has_table_privilege(${pg.systemLogin.user}, t, 'DELETE')`);
    expect(denied.map((r) => r.name)).toEqual([]);
  });

  it('deletes every row of the business in batches and keeps the other business whole', async () => {
    const before = await count('contacts', b);
    const report = await purgeWorkspaceRows(systemDb.db, a, { batchSize: 2 });
    expect(report['contacts']).toBe(5);
    expect(report['contact_notes']).toBe(5);
    expect(report['purge_tree_probe']).toBe(5);
    for (const table of await tablesWithWorkspaceId()) {
      if (PURGE_RETAINED_TABLES.includes(table)) continue;
      expect(await count(table, a), table).toBe(0);
    }
    expect(await count('audit_events', a)).toBe(1);
    expect(await count('message_usage', a)).toBe(1);
    expect(await count('workspaces', a)).toBe(1);
    expect(await count('contacts', b)).toBe(before);
    expect(await count('purge_tree_probe', b)).toBe(5);
    expect(await count('members', b)).toBe(1);
    expect(await count('tenant_routes', b)).toBe(1);
  });

  it('is a no-op when run again', async () => {
    expect(await purgeWorkspaceRows(systemDb.db, a, { batchSize: 2 })).toEqual({});
  });
});
