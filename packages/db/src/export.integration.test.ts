import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDb, type Database } from './client.js';
import { exportTable, type ExportCell } from './export.js';
import { ensureLoginRoles, migrate, withCredentials } from './migrate.js';

/** Workspace export reader (SET-10): pages, tenant isolation, column expressions, `where`. */
let pg: TestPostgres;
let tenantDb: { db: Database; close: () => Promise<void> };
let ownerDb: { db: Database; close: () => Promise<void> };
const a: WorkspaceId = workspaceId(newId());
const b: WorkspaceId = workspaceId(newId());

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, {
    tenant: pg.tenantLogin,
    system: pg.systemLogin,
    assistantSql: pg.assistantSqlLogin,
  });
  tenantDb = createDb({
    url: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    max: 1,
  });
  ownerDb = createDb({ url: pg.ownerUrl, max: 1 });
  // A probe table with the same RLS shape as every tenant table (ADR-004).
  await ownerDb.db.execute(sql`
    create table export_probe (id uuid primary key, workspace_id uuid not null, name text,
      data jsonb, created_at timestamptz not null default now(), hidden boolean not null default false);
    alter table export_probe enable row level security;
    alter table export_probe force row level security;
    create policy export_probe_tenant on export_probe for all to app_tenant
      using (workspace_id = (select nullif(current_setting('app.workspace_id', true), '')::uuid));
    grant select on export_probe to app_tenant;`);
  for (const [ws, n] of [
    [a, 7],
    [b, 3],
  ] as const) {
    for (let i = 0; i < n; i++) {
      await ownerDb.db.execute(
        sql`insert into export_probe (id, workspace_id, name, data, hidden)
            values (${newId()}, ${ws}, ${`row ${i}`}, ${JSON.stringify({ i })}::jsonb, ${i === 0})`,
      );
    }
  }
});

afterAll(async () => {
  await Promise.all([tenantDb?.close(), ownerDb?.close()]);
  await pg?.stop();
});

async function collect(pages: AsyncIterable<readonly ExportCell[][]>): Promise<ExportCell[][]> {
  const out: ExportCell[][] = [];
  for await (const page of pages) out.push(...page);
  return out;
}

describe('exportTable', () => {
  const spec = {
    file: 'probe.csv',
    table: 'export_probe',
    columns: [
      { header: 'name', sql: 't.name' },
      { header: 'i', sql: "(t.data->>'i')::int" },
      { header: 'created_at', sql: 't.created_at', time: true },
    ],
  };

  it('reads every row of the workspace across pages, never another workspace', async () => {
    const table = exportTable(tenantDb.db, a, spec, 2);
    expect(table.columns).toEqual(['name', 'i', 'created_at']);
    const rows = await collect(table.rows());
    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r[1]).sort()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(rows[0]![2]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(await collect(exportTable(tenantDb.db, b, spec, 2).rows())).toHaveLength(3);
  });

  it('applies the extra condition', async () => {
    const rows = await collect(
      exportTable(tenantDb.db, a, { ...spec, where: 'not t.hidden' }, 4).rows(),
    );
    expect(rows).toHaveLength(6);
  });

  it('rejects a table name that is not a plain identifier', () => {
    expect(() => exportTable(tenantDb.db, a, { ...spec, table: 'x; drop table y' })).toThrow();
  });
});
