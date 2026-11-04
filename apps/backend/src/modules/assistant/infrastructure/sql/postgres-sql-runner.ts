import { type AssistantSqlClient, AssistantSqlError, runAssistantSql } from '@agent-sales/db';
import { Logger } from '@nestjs/common';

import { sqlFingerprint } from '../../application/sql/sql-tools.js';
import { SQL_VIEW_NAMES } from '../../application/sql/sql-views.js';
import {
  type SqlRunner,
  SqlRunError,
  type SqlRunResult,
} from '../../domain/ports/sql-runner.port.js';
import { checkSql } from '../../domain/sql-guard.js';

/** Said for every connection-level failure; the cause is not passed to the model. */
const unavailable = () => new SqlRunError('08000', 'unavailable');

/**
 * The SQL lane on Postgres (spec §5): `runAssistantSql` on the assistant's own login, one
 * `READ ONLY` transaction per query with transaction-local scope, `statement_timeout`,
 * `idle_in_transaction_session_timeout` and the other limits, all read back before the query
 * runs. The text is guarded again here, right before it reaches the database, so no caller
 * reaches the database with unguarded SQL. Postgres errors become `SqlRunError(sqlstate)`;
 * connection failures (no SQL state, or class 08) become `SqlRunError('08000', 'unavailable')`.
 * The SQL text and the rows are never logged: only a fingerprint (hash and length).
 */
export class PostgresSqlRunner implements SqlRunner {
  readonly #log = new Logger(PostgresSqlRunner.name);

  constructor(private readonly client: AssistantSqlClient) {}

  async run(i: {
    accountId: string;
    businessIds: readonly string[];
    sql: string;
  }): Promise<SqlRunResult> {
    const guard = checkSql(i.sql, { views: SQL_VIEW_NAMES });
    if (!guard.ok) {
      this.#log.warn(`assistant sql runner: rejected by the guard (${sqlFingerprint(i.sql)})`);
      throw new SqlRunError('42501', `rejected by the SQL guard: ${guard.reason}`);
    }
    try {
      return await runAssistantSql(this.client, {
        accountId: i.accountId,
        businessIds: i.businessIds,
        sql: guard.sql,
      });
    } catch (e) {
      if (e instanceof AssistantSqlError) {
        if (e.sqlstate.startsWith('08')) throw unavailable();
        throw new SqlRunError(e.sqlstate, e.message);
      }
      const name = e instanceof Error ? e.name : typeof e;
      this.#log.warn(`assistant sql runner: unavailable (${name}) (${sqlFingerprint(i.sql)})`);
      throw unavailable();
    }
  }
}
