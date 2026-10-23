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
 * `db` must be a connection logged in as a member of `app_tenant`.
 * This is the ONLY sanctioned way to touch tenant tables; lint forbids using
 * the raw handle outside packages/db and infrastructure/.
 */
export async function withTenant<T>(
  db: Database,
  workspaceId: WorkspaceId,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(tenantContextSql(workspaceId));
    const rows = await tx.execute<{ ws: string | null }>(
      sql`select nullif(current_setting('app.workspace_id', true), '') as ws`,
    );
    if (rows[0]?.ws !== workspaceId) {
      throw new Error('withTenant: tenant context was not applied');
    }
    return fn(tx);
  });
}

/**
 * Cross-tenant work (webhook ingress, scheduler, reconciliation, back-office).
 * `db` must be a connection logged in as a member of `app_system`; isolation
 * comes from the DB role and its policies, never from a settable flag.
 */
export async function withSystem<T>(db: Database, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return db.transaction(fn);
}
