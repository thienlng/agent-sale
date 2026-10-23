import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DbOptions {
  url: string;
  /** Max connections for this process. Keep small: PgBouncer multiplexes. */
  max?: number;
}

/**
 * Creates the Drizzle client. The connection goes through PgBouncer in
 * transaction-pooling mode, so: no session state, no LISTEN, and prepared
 * statements disabled (`prepare: false`) unless PgBouncer >= 1.21 with
 * max_prepared_statements is confirmed (ADR-004).
 */
export function createDb(options: DbOptions): { db: Database; close: () => Promise<void> } {
  const sql = postgres(options.url, { max: options.max ?? 10, prepare: false });
  const db = drizzle(sql, { schema });
  return { db, close: () => sql.end() };
}
