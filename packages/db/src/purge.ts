import type { WorkspaceId } from '@agent-sales/shared';
import { sql } from 'drizzle-orm';

import type { Database } from './client.js';
import { type TenantTx, withSystem } from './tenant.js';

/**
 * Tables with a `workspace_id` that the business purge keeps (ADR-032):
 * - `audit_events`: append-only, at least a year of retention, no DELETE grant (docs/09 §5);
 * - `message_usage`: the account's AI-reply allowance of the cycle (billing fact of the account,
 *   ids only, no content);
 * - `workspaces`: becomes a tombstone (status `deleted`, name and profile erased) so the two above
 *   and the account-scoped references (`assistant_*.business_id`, `account_subscriptions`) keep
 *   their foreign key.
 * Every other table with a `workspace_id` column is purged; a new one is purged automatically.
 */
export const PURGE_RETAINED_TABLES: readonly string[] = [
  'audit_events',
  'message_usage',
  'workspaces',
];

/** One table of the purge, in delete order. */
export interface PurgeTable {
  name: string;
  /**
   * The table references itself with a foreign key that does not cascade: its rows of one business
   * go in one statement, because a batch could delete a parent whose child is in the next batch.
   */
  singleStatement: boolean;
}

export type CatalogFk = {
  child: string;
  parent: string;
  /** `a` no action, `r` restrict, `c` cascade, `n` set null, `d` set default. */
  onDelete: string;
};

/**
 * The tables to purge, children before parents, read from the Postgres catalog at run time: every
 * ordinary or partitioned table of schema `public` with a `workspace_id` column, except
 * {@link PURGE_RETAINED_TABLES}. Foreign keys between them decide the order; a cycle throws.
 */
export async function workspacePurgeOrder(tx: TenantTx): Promise<PurgeTable[]> {
  const tables = (
    await tx.execute<{ name: string }>(sql`
      select c.relname as name
      from pg_attribute a
      join pg_class c on c.oid = a.attrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and a.attname = 'workspace_id' and not a.attisdropped
        and c.relkind in ('r', 'p') and not c.relispartition
      order by c.relname`)
  )
    .map((r) => r.name)
    .filter((name) => !PURGE_RETAINED_TABLES.includes(name));
  const fks = await tx.execute<CatalogFk>(sql`
    select ch.relname as child, pa.relname as parent, k.confdeltype as "onDelete"
    from pg_constraint k
    join pg_class ch on ch.oid = k.conrelid
    join pg_class pa on pa.oid = k.confrelid
    join pg_namespace n on n.oid = ch.relnamespace
    where k.contype = 'f' and n.nspname = 'public'`);
  return deleteOrder(tables, [...fks]);
}

/** Children before parents (Kahn's algorithm, ties by name so the order is stable). */
export function deleteOrder(tables: readonly string[], fks: readonly CatalogFk[]): PurgeTable[] {
  const inSet = new Set(tables);
  const children = new Map<string, Set<string>>(tables.map((t) => [t, new Set<string>()]));
  const singleStatement = new Set<string>();
  for (const fk of fks) {
    if (!inSet.has(fk.child) || !inSet.has(fk.parent)) continue;
    if (fk.child === fk.parent) {
      if (fk.onDelete !== 'c') singleStatement.add(fk.child);
      continue;
    }
    children.get(fk.parent)?.add(fk.child);
  }
  const out: PurgeTable[] = [];
  const done = new Set<string>();
  while (done.size < tables.length) {
    const ready = tables.filter(
      (t) => !done.has(t) && [...(children.get(t) ?? [])].every((c) => done.has(c)),
    );
    if (!ready.length) {
      const left = tables.filter((t) => !done.has(t)).join(', ');
      throw new Error(`workspace purge: foreign-key cycle among ${left}`);
    }
    for (const t of ready) {
      done.add(t);
      out.push({ name: t, singleStatement: singleStatement.has(t) });
    }
  }
  return out;
}

/** Rows deleted per table by one purge run. */
export type PurgeReport = Record<string, number>;

/**
 * Hard-deletes every row of one business from every purged table (ADR-032), in batches of
 * `batchSize`, each batch its own `withSystem` transaction: a crash or a retry resumes where it
 * stopped, and a finished table is a cheap no-op. `db` must be the system login (`app_system`).
 * Leaves the retained tables and the `workspaces` row alone; the caller writes the tombstone.
 */
export async function purgeWorkspaceRows(
  db: Database,
  ws: WorkspaceId,
  opts: { batchSize?: number } = {},
): Promise<PurgeReport> {
  const batch = Math.max(1, Math.trunc(opts.batchSize ?? 2000));
  const order = await withSystem(db, (tx) => workspacePurgeOrder(tx));
  const report: PurgeReport = {};
  for (const table of order) {
    const t = sql.identifier(table.name);
    let total = 0;
    for (;;) {
      const deleted = await withSystem(db, async (tx) => {
        const rows = table.singleStatement
          ? await tx.execute<{ n: number }>(sql`
              with d as (delete from ${t} where workspace_id = ${ws} returning 1)
              select count(*)::int as n from d`)
          : await tx.execute<{ n: number }>(sql`
              with d as (
                delete from ${t} where (tableoid, ctid) in (
                  select tableoid, ctid from ${t} where workspace_id = ${ws} limit ${batch})
                returning 1)
              select count(*)::int as n from d`);
        return Number(rows[0]?.n ?? 0);
      });
      total += deleted;
      if (table.singleStatement || deleted < batch) break;
    }
    if (total) report[table.name] = total;
  }
  return report;
}
