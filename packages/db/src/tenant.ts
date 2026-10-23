import type { WorkspaceId } from '@agent-sales/shared';
import { sql } from 'drizzle-orm';

import type { Database } from './client.js';

/** The transaction handle passed to repositories. */
export type TenantTx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Statement that scopes the current transaction to one workspace (ADR-004). */
export function tenantContextSql(workspaceId: WorkspaceId) {
  // `true` = transaction-local; safe behind PgBouncer transaction pooling.
  return sql`select set_config('app.workspace_id', ${workspaceId}, true)`;
}

/**
 * Runs `fn` inside a transaction whose RLS context is `workspaceId`.
 * This is the ONLY sanctioned way to touch tenant tables; the lint rules
 * forbid using the raw `db` handle outside packages/db.
 */
export async function withTenant<T>(
  db: Database,
  workspaceId: WorkspaceId,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(tenantContextSql(workspaceId));
    const [row] = await tx.execute<{ ws: string | null }>(
      sql`select nullif(current_setting('app.workspace_id', true), '') as ws`,
    );
    if (row?.ws !== workspaceId) {
      throw new Error('withTenant: tenant context was not applied');
    }
    return fn(tx);
  });
}

/**
 * Cross-tenant work (webhook ingress, scheduler, reconciliation, back-office)
 * runs as the `app_system` role with an explicit marker, never by bypassing RLS.
 */
export async function withSystem<T>(db: Database, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.role', 'system', true)`);
    return fn(tx);
  });
}
