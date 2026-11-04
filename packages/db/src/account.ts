import { sql } from 'drizzle-orm';

import type { Database } from './client.js';
import type { TenantTx } from './tenant.js';

/** Statement that scopes the current transaction to one account (ADR-024, assistant data). */
export function accountContextSql(accountId: string) {
  // `true` = transaction-local; safe behind PgBouncer transaction pooling.
  return sql`select set_config('app.account_id', ${accountId}, true)`;
}

/**
 * Runs `fn` in a transaction whose RLS context is `accountId` (app_tenant login).
 * Same contract as `withTenant`, for the account-scoped assistant tables.
 */
export async function withAccount<T>(
  db: Database,
  accountId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(accountContextSql(accountId));
    const rows = await tx.execute<{ acc: string | null }>(
      sql`select nullif(current_setting('app.account_id', true), '') as acc`,
    );
    if (rows[0]?.acc !== accountId) throw new Error('withAccount: account context was not applied');
    return fn(tx);
  });
}
