import postgres from 'postgres';

/**
 * The owner assistant's read-only SQL lane (T-171, spec §5): a small postgres.js pool on its own
 * login (`DATABASE_ASSISTANT_SQL_URL`, a member of `app_assistant_sql` only), and one query per
 * `READ ONLY` transaction with transaction-local scope GUCs and limits. The SQL text has already
 * passed the assistant's SQL guard; the login's grants, the reader's RLS policies and the
 * read-only transaction hold even when it did not.
 */
export type AssistantSqlClient = postgres.Sql;

/** Date and time types come back as the raw text Postgres sends, in the session time zone. */
const RAW_TIME_OIDS = [1082, 1083, 1114, 1184, 1186];

export function createAssistantSqlClient(
  url: string,
  max = 4,
): { sql: AssistantSqlClient; close(): Promise<void> } {
  const sql = postgres(url, {
    max,
    prepare: false,
    onnotice: () => undefined,
    connection: { application_name: 'rapiz-assistant-sql' },
    types: {
      rawTime: {
        to: 25,
        from: RAW_TIME_OIDS,
        serialize: (x: unknown) => String(x),
        parse: (x: string) => x,
      },
    },
  }) as unknown as AssistantSqlClient;
  return { sql, close: () => sql.end() };
}

export interface AssistantSqlColumn {
  name: string;
  type: 'number' | 'text' | 'boolean' | 'date' | 'other';
}

export interface AssistantSqlResult {
  columns: AssistantSqlColumn[];
  rows: (string | number | boolean | null)[][];
  truncated: boolean;
}

/** A Postgres error from the query (`sqlstate` such as `57014` timeout or `42501` denied). */
export class AssistantSqlError extends Error {
  constructor(
    readonly sqlstate: string,
    message: string,
  ) {
    super(message);
    this.name = 'AssistantSqlError';
  }
}

export const ASSISTANT_SQL_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_MAX_ROWS = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NUMBER_OIDS = new Set([20, 21, 23, 700, 701, 1700]);
const DATE_OIDS = new Set([1082, 1114, 1184]);
const TEXT_OIDS = new Set([25, 1043, 2950]);

function columnType(oid: number): AssistantSqlColumn['type'] {
  if (NUMBER_OIDS.has(oid)) return 'number';
  if (oid === 16) return 'boolean';
  if (DATE_OIDS.has(oid)) return 'date';
  if (TEXT_OIDS.has(oid)) return 'text';
  return 'other';
}

/** A number cell as a JS number when that loses nothing that matters, else the exact text. */
function numberCell(x: unknown): number | string {
  if (typeof x === 'number') return x;
  const text = String(x);
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  if (/^[+-]?\d+$/.test(text) && !Number.isSafeInteger(n)) return text;
  return n;
}

function cell(x: unknown, type: AssistantSqlColumn['type']): string | number | boolean | null {
  if (x === null || x === undefined) return null;
  switch (type) {
    case 'number':
      return numberCell(x);
    case 'boolean':
      return typeof x === 'boolean' ? x : String(x);
    case 'other':
      return String(x);
    default:
      return typeof x === 'string' ? x : String(x);
  }
}

interface AppliedSettings {
  account: string | null;
  businesses: string | null;
  statement_timeout: string;
  idle_timeout: string;
  read_only: string;
}

interface RawColumn {
  name: string;
  type: number;
}

const isPostgresError = (e: unknown): e is { code: string; message: string } =>
  typeof e === 'object' &&
  e !== null &&
  typeof (e as { code?: unknown }).code === 'string' &&
  /^[0-9A-Z]{5}$/.test((e as { code: string }).code) &&
  (e as { name?: unknown }).name === 'PostgresError';

/**
 * Runs one query for an owner: inside a `READ ONLY` transaction, with `app.account_id` and
 * `app.assistant_business_ids` set transaction-locally (`set_config(…, true)`, the same as
 * `SET LOCAL`), a 3 s statement timeout, a 5 s idle-in-transaction timeout, the Asia/Ho_Chi_Minh
 * time zone and `search_path = assistant_sql`. The scope, both timeouts and the read-only flag are
 * read back before the query runs (like `withAccount`); any mismatch throws.
 * At most `maxRows + 1` rows are fetched through a cursor (the model's `ORDER BY` holds and the
 * text runs unchanged); `truncated` says there were more. Postgres errors become
 * `AssistantSqlError`. The SQL text and the rows are never logged here.
 */
export async function runAssistantSql(
  client: AssistantSqlClient,
  input: { accountId: string; businessIds: readonly string[]; sql: string; maxRows?: number },
): Promise<AssistantSqlResult> {
  const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;
  if (
    !UUID.test(input.accountId) ||
    input.businessIds.length === 0 ||
    !input.businessIds.every((id) => UUID.test(id)) ||
    !Number.isSafeInteger(maxRows) ||
    maxRows < 1
  ) {
    throw new Error('assistant_sql: bad scope');
  }
  const businessIds = `{${input.businessIds.join(',')}}`;
  try {
    return await client.begin('read only', async (tx) => {
      await tx`select
        set_config('app.account_id', ${input.accountId}, true),
        set_config('app.assistant_business_ids', ${businessIds}, true),
        set_config('statement_timeout', '3000', true),
        set_config('lock_timeout', '1000', true),
        set_config('idle_in_transaction_session_timeout', '5000', true),
        set_config('search_path', 'assistant_sql', true),
        set_config('TimeZone', ${ASSISTANT_SQL_TIMEZONE}, true),
        set_config('work_mem', '16MB', true)`;
      // Read back the scope and the limits: the query never runs without them, nor outside a
      // read-only transaction.
      const [applied] = await tx<AppliedSettings[]>`select
        current_setting('app.account_id', true) as account,
        current_setting('app.assistant_business_ids', true) as businesses,
        current_setting('statement_timeout') as statement_timeout,
        current_setting('idle_in_transaction_session_timeout') as idle_timeout,
        current_setting('transaction_read_only') as read_only`;
      if (
        applied?.account !== input.accountId ||
        applied.businesses !== businessIds ||
        applied.statement_timeout !== '3s' ||
        applied.idle_timeout !== '5s' ||
        applied.read_only !== 'on'
      ) {
        throw new Error('assistant_sql: context was not applied');
      }

      // Extended protocol (a cursor never uses the simple one): one statement only.
      const query = tx.unsafe(input.sql).values();
      let batch: unknown[][] = [];
      for await (const rows of query.cursor(maxRows + 1)) {
        batch = rows as unknown as unknown[][];
        break;
      }
      // An empty result has no batch; the statement still carries the row description.
      const raw: RawColumn[] =
        (batch as unknown as { columns?: RawColumn[] }).columns ??
        (query as unknown as { statement?: { columns?: RawColumn[] | null } }).statement?.columns ??
        [];
      const columns = raw.map((c) => ({ name: c.name, type: columnType(c.type) }));
      const rows = batch
        .slice(0, maxRows)
        .map((row) => columns.map((c, i) => cell(row[i], c.type)));
      return { columns, rows, truncated: batch.length > maxRows };
    });
  } catch (e) {
    if (isPostgresError(e)) throw new AssistantSqlError(e.code, e.message);
    throw e;
  }
}
