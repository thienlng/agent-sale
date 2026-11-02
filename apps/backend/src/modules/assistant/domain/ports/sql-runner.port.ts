/**
 * The owner assistant's read-only SQL lane (T-171, spec §5–§6): runs one guarded `SELECT` over
 * the curated `assistant_sql` views for an owner, inside a `READ ONLY` transaction scoped to the
 * owner's account and the named businesses. Implementations guard the text again before it
 * reaches the database and never log it.
 */
export interface SqlRunColumn {
  name: string;
  type: 'number' | 'text' | 'boolean' | 'date' | 'other';
}

export interface SqlRunResult {
  columns: SqlRunColumn[];
  rows: (string | number | boolean | null)[][];
  /** More rows existed than were fetched. */
  truncated: boolean;
}

/** A failed query: `sqlstate` is the Postgres code (`08000` when the database is unreachable). */
export class SqlRunError extends Error {
  constructor(
    readonly sqlstate: string,
    message: string,
  ) {
    super(message);
    this.name = 'SqlRunError';
  }
}

export interface SqlRunner {
  run(i: { accountId: string; businessIds: readonly string[]; sql: string }): Promise<SqlRunResult>;
}

/** Provides `SqlRunner | null`; null when `DATABASE_ASSISTANT_SQL_URL` is unset. */
export const ASSISTANT_SQL_RUNNER = Symbol('ASSISTANT_SQL_RUNNER');
