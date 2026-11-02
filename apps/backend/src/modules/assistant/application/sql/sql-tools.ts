import { createHash } from 'node:crypto';

import type { AssistantUiAction } from '@agent-sales/contracts';
import { z, type ZodType } from 'zod';

import type { OwnerScope } from '../../domain/owner-scope.js';
import { SqlRunError, type SqlRunner } from '../../domain/ports/sql-runner.port.js';
import { checkSql, MAX_SQL_CHARS } from '../../domain/sql-guard.js';
import { renderSqlOverview, renderSqlView, SQL_VIEW_NAMES } from './sql-views.js';

/**
 * A tool of the deferred catalog that runs in process (T-171, ruling 2-R5): found by
 * `tool_search`, described by `tool_describe` and run by `tool_call` with its input in `body`.
 * It is not in the always-loaded tool list.
 */
export interface NativeToolEntry {
  key: string;
  summary: string;
  /** English, rich in the words an owner's question uses (tool_search matches on it). */
  when: string;
  toolset: 'sql';
  input: ZodType;
  run(input: unknown): Promise<{ content: string; ok?: boolean }>;
}

export const SQL_TOOLSET = 'sql';
export const SQL_QUERY_KEY = 'sql_query';
export const SQL_SCHEMA_KEY = 'sql_schema';
export const MAX_SQL_CALLS_PER_TURN = 8;
export const MAX_SQL_CELL_CHARS = 200;
/** The JSON the model sees for one query is never longer than this. */
export const MAX_SQL_RESULT_CHARS = 8_000;
export const MAX_SQL_MESSAGE_CHARS = 300;
export const MAX_SQL_BUSINESS_IDS = 50;
export const ROWS_DROPPED_NOTE = 'rowsShown < rowCount: aggregate or filter instead of listing';

const SqlSchemaInput = z.object({ view: z.string().trim().min(1).max(63).optional() });
const SqlQueryInput = z.object({
  sql: z.string().min(1).max(MAX_SQL_CHARS),
  businessIds: z.array(z.uuid()).min(1).max(MAX_SQL_BUSINESS_IDS).optional(),
  // The chart request arrives with the chart builder (T-171 Task 4); ignored until then.
  chart: z.unknown().optional(),
});

/** `<` is escaped so a result cannot open or close a prompt tag (as in the route tools). */
const json = (value: unknown): string => JSON.stringify(value).replaceAll('<', '\\u003c');

const fail = (errorCode: string, extra: Record<string, unknown> = {}) => ({
  content: json({ ok: false, errorCode, ...extra }),
  ok: false,
});

const cutText = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
};

/** A short fingerprint of the SQL text for logs: the text itself is never logged. */
export const sqlFingerprint = (sql: string): string =>
  `sql=${createHash('sha256').update(sql).digest('hex').slice(0, 12)} len=${sql.length}`;

/** Spec §6 step 3: the model's error code for a Postgres SQL state. */
export function sqlErrorCode(sqlstate: string): string {
  if (sqlstate === '57014') return 'sql_timeout';
  if (sqlstate === '42501') return 'sql_permission_denied';
  if (sqlstate === '42P01' || sqlstate === '42703') return 'sql_unknown_name';
  if (sqlstate.startsWith('08')) return 'sql_unavailable';
  return 'sql_error';
}

const HINTS: Record<string, string> = {
  sql_timeout: 'add a date filter or aggregate',
  sql_permission_denied: 'only the views listed by sql_schema can be read',
  sql_unknown_name: 'check the view and column names with sql_schema',
  sql_unavailable: 'the data service is unavailable; answer without figures',
};

type Cell = string | number | boolean | null;

/**
 * The result as the model reads it: string cells cut to 200 chars, at most 8 000 chars of JSON
 * (rows dropped from the end, `rowsShown` says how many are kept, with a note).
 */
export function renderSqlResult(r: {
  columns: { name: string; type: string }[];
  rows: Cell[][];
  truncated: boolean;
}): string {
  const rows = r.rows.map((row) =>
    row.map((c) => (typeof c === 'string' ? cutText(c, MAX_SQL_CELL_CHARS) : c)),
  );
  const build = (shown: number) =>
    json({
      ok: true,
      columns: r.columns.map((c) => c.name),
      types: r.columns.map((c) => c.type),
      rows: rows.slice(0, shown),
      rowCount: rows.length,
      rowsShown: shown,
      truncated: r.truncated,
      ...(shown < rows.length ? { note: ROWS_DROPPED_NOTE } : {}),
    });
  const all = build(rows.length);
  if (all.length <= MAX_SQL_RESULT_CHARS) return all;
  // The largest row count that fits (the length grows with the rows kept).
  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (build(mid).length <= MAX_SQL_RESULT_CHARS) lo = mid;
    else hi = mid - 1;
  }
  return build(lo);
}

export interface SqlToolContext {
  scope: OwnerScope;
  runner: SqlRunner;
  /** The turn's UI actions (charts join them in Task 4). */
  uiActions: AssistantUiAction[];
  /** Charts made during the turn. */
  charts: { count: number };
  /** For the failure log line only. */
  runId?: string;
  /** Failure lines (error code, SQL state, run id and a fingerprint; never the SQL or rows). */
  log?: (line: string) => void;
}

/** `sql_schema` and `sql_query` for one turn (spec §6). */
export function sqlTools(ctx: SqlToolContext): NativeToolEntry[] {
  let calls = 0;
  const allowed = new Set<string>(ctx.scope.businessIds);
  const logFailure = (errorCode: string, sqlstate: string | null, sql: string) =>
    ctx.log?.(
      `assistant sql: ${errorCode} sqlstate=${sqlstate ?? '-'} run=${ctx.runId ?? '-'} ${sqlFingerprint(sql)}`,
    );

  const schema: NativeToolEntry = {
    key: SQL_SCHEMA_KEY,
    toolset: 'sql',
    summary: 'The read-only SQL views of the shop data, their columns and the query rules',
    when: 'Answer number questions about the shop: revenue, sales, profit, orders, best-selling products, stock, new customers by source, conversations and messages per channel or bot, lodging bookings. Read the SQL views first.',
    input: SqlSchemaInput,
    run(raw) {
      const { view } = raw as z.output<typeof SqlSchemaInput>;
      if (view === undefined) return Promise.resolve({ content: json(renderSqlOverview()) });
      const text = renderSqlView(view);
      if (text === null) {
        return Promise.resolve(fail('unknown_view', { views: [...SQL_VIEW_NAMES] }));
      }
      return Promise.resolve({ content: json(text) });
    },
  };

  const query: NativeToolEntry = {
    key: SQL_QUERY_KEY,
    toolset: 'sql',
    summary:
      'Run one read-only SELECT over the SQL views and get the rows (figures for the answer)',
    when: 'Count, sum or compare shop figures for a date range: revenue today, this week, this month or last month, sales, profit, order count, top products by quantity, stock, new customers by source, inbound and outbound messages per day, conversations per channel, lodging nights. Write the SQL after sql_schema.',
    input: SqlQueryInput,
    async run(raw) {
      const input = raw as z.output<typeof SqlQueryInput>;
      calls += 1;
      if (calls > MAX_SQL_CALLS_PER_TURN) {
        return fail('sql_query_limit', { max: MAX_SQL_CALLS_PER_TURN });
      }
      const guard = checkSql(input.sql, { views: SQL_VIEW_NAMES });
      if (!guard.ok) {
        logFailure('sql_rejected', null, input.sql);
        return fail('sql_rejected', { reason: guard.reason });
      }
      const businessIds = input.businessIds
        ? [...new Set(input.businessIds.map((id) => id.toLowerCase()))]
        : [...ctx.scope.businessIds];
      if (!businessIds.every((id) => allowed.has(id))) return fail('unknown_business');
      try {
        const result = await ctx.runner.run({
          accountId: ctx.scope.accountId,
          businessIds,
          sql: guard.sql,
        });
        return { content: renderSqlResult(result) };
      } catch (e) {
        const sqlstate = e instanceof SqlRunError ? e.sqlstate : '08000';
        const errorCode = sqlErrorCode(sqlstate);
        logFailure(errorCode, sqlstate, input.sql);
        const hint = HINTS[errorCode];
        return fail(errorCode, {
          sqlstate,
          ...(errorCode !== 'sql_unavailable' && e instanceof SqlRunError
            ? { message: cutText(e.message, MAX_SQL_MESSAGE_CHARS) }
            : {}),
          ...(hint ? { hint } : {}),
        });
      }
    },
  };

  return [schema, query];
}
