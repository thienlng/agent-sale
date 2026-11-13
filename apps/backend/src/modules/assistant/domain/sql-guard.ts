/**
 * The SQL guard of the owner assistant's read-only SQL lane (spec §7): a hand-written lexer with
 * keyword, function and type allow-lists, so the model may run one `SELECT` (or `WITH … SELECT`)
 * over the curated `assistant_sql` views and nothing else. It is strict on purpose: when unsure,
 * it rejects. The database grants, RLS policies and the read-only transaction are the real
 * boundary; the guard gives early, readable errors and closes the function and GUC paths
 * (`set_config`, `current_setting`, `query_to_xml`, `pg_*`). Pure: no I/O, no dependency.
 */

export type SqlGuardResult =
  { ok: true; sql: string; relations: string[] } | { ok: false; reason: string };

export interface SqlGuardOptions {
  /** View names the query may read, lower case (schema `assistant_sql`, unqualified). */
  views: ReadonlySet<string>;
}

export const MAX_SQL_CHARS = 4_000;
const MAX_TOKENS = 1_000;
const MAX_DEPTH = 10;
/** Longest string literal, quotes included: names and dates, never bulk text (final review C1). */
export const MAX_STRING_LITERAL_CHARS = 200;
/** Most CTEs in one query. */
export const MAX_CTES = 10;
/**
 * Most FROM / JOIN items in one query, comma-joined ones included. `work_mem` caps each plan node,
 * not the query, so a long cross join of in-memory nodes adds up (final re-review I-A).
 */
export const MAX_FROM_ITEMS = 6;
/** Most `generate_series` calls in one query: each one materializes its rows (re-review I-A). */
export const MAX_GENERATE_SERIES = 1;

/** Words that end a FROM list at the same parenthesis level. */
const FROM_END_WORDS = new Set(
  'where group having order limit offset window union intersect except fetch'.split(' '),
);

const DENIED_WORDS = new Set(
  (
    'insert update delete merge into copy create alter drop grant revoke truncate set reset lock ' +
    'for call do execute prepare deallocate listen notify unlisten vacuum analyze explain refresh ' +
    'cluster reindex checkpoint load import discard declare fetch move close cursor returning ' +
    'table only tablesample current_user session_user current_role user system_user ' +
    'current_catalog current_schema public assistant_sql information_schema recursive'
  ).split(' '),
);

/** SQL keywords that may be followed by `(` without being a function call. */
const PAREN_KEYWORDS = new Set(
  (
    'in exists any all some over filter as values using on and or not select from where join ' +
    'when then else case by having union intersect except between is like ilike distinct within ' +
    'group partition'
  ).split(' '),
);

const ALLOWED_FUNCTIONS = new Set(
  [
    // aggregates
    'count sum avg min max bool_and bool_or every percentile_cont percentile_disc mode',
    // window functions
    'row_number rank dense_rank percent_rank cume_dist ntile lag lead first_value last_value',
    // math
    'round trunc floor ceil ceiling abs greatest least',
    // null handling
    'coalesce nullif',
    // dates
    'date_trunc date_part extract to_char make_date make_interval age now generate_series',
    // strings: none that builds a longer string (`concat`, `replace`, `repeat`, `lpad`, `||`, …),
    // so an expression can never grow past its inputs (final review C1)
    'lower upper length btrim trim ltrim rtrim substr left right split_part initcap position',
  ]
    .join(' ')
    .split(' '),
);

/**
 * What the model is told when the guard rejects a query (AS3-1): the functions and operators it
 * may use, and what to write instead of a string-building one.
 */
export function sqlRejectionHint(reason: string): string {
  const allowed = `allowed functions: ${[...ALLOWED_FUNCTIONS].join(', ')}; operators: ${[...ALLOWED_OPERATORS].join(' ')}`;
  if (
    reason === 'operator:||' ||
    /^function_not_allowed:(concat|string_agg|array_agg|format|replace|repeat|lpad|rpad)/.test(
      reason,
    )
  ) {
    return `Building strings or arrays is not allowed: return the parts as separate columns, or one row per item with group by. ${allowed}`;
  }
  if (reason.startsWith('function_not_allowed') || reason.startsWith('operator:')) return allowed;
  return 'one SELECT (WITH is fine) over the views of sql_schema';
}

/** Set-returning functions that may stand where a relation goes (`from generate_series(…) d`). */
const RELATION_FUNCTIONS = new Set(['generate_series']);

const CAST_TYPES = new Set(
  (
    'date timestamp timestamptz time interval numeric decimal int integer bigint smallint real ' +
    'float text varchar boolean bool'
  ).split(' '),
);
const TYPED_LITERAL_TYPES = new Set(['date', 'timestamp', 'timestamptz', 'time', 'interval']);

/**
 * Keywords that may be followed directly by a string literal without forming a typed literal
 * (`name ilike '%a%'`, `then 'x'`, `at time zone 'Asia/Ho_Chi_Minh'`). Any other identifier
 * followed by a string is read as a type name and must be a date or time type.
 */
const EXPRESSION_KEYWORDS = new Set(
  (
    'select where and or not like ilike when then else case in is between from by having on as ' +
    'distinct all any some escape zone leading trailing both similar to union intersect except ' +
    'values using join limit offset with'
  ).split(' '),
);

const STRING_PREFIXES = new Set(['e', 'u', 'b', 'x', 'n']);
const ALLOWED_OPERATORS = new Set(['=', '<>', '!=', '<', '>', '<=', '>=', '+', '-', '*', '/', '%']);
/** Postgres operator characters: a run of them lexes as one operator. */
const OPERATOR_CHARS = new Set('+-*/<>=~!@#%^&|`?'.split(''));
/** In a run ending with `+`/`-`, these keep the trailing sign part of the operator (PG lexer). */
const NON_MATH_OPERATOR_CHARS = /[~!@#%^&|`?]/;

type TokenKind = 'ident' | 'number' | 'string' | 'op' | 'punct';
interface Token {
  kind: TokenKind;
  /** Identifiers are folded to lower case; punctuation is `( ) , . ::`. */
  value: string;
  /** Offset of the first character in the text. */
  start: number;
  end: number;
}

type Lexed = { ok: true; tokens: Token[] } | { ok: false; reason: string };

const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });

const isIdentStart = (c: string): boolean => /[A-Za-z_]/.test(c);
const isIdentChar = (c: string): boolean => /[A-Za-z0-9_]/.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

function lex(text: string): Lexed {
  const tokens: Token[] = [];
  let i = 0;
  while (i < text.length) {
    const c = text.charAt(i);
    if (c === ' ' || c === '\n' || c === '\r' || c === '\t') {
      i += 1;
      continue;
    }
    if (c.charCodeAt(0) > 0x7f) return fail('bad_chars');
    if (isIdentStart(c)) {
      let j = i + 1;
      while (j < text.length && isIdentChar(text.charAt(j))) j += 1;
      const word = text.slice(i, j).toLowerCase();
      // E'…', B'…', X'…', N'…' and U&'…' change how the string is read: never allowed.
      if (text[j] === "'" && STRING_PREFIXES.has(word)) return fail('string_prefix');
      if (word === 'u' && text[j] === '&' && (text[j + 1] === "'" || text[j + 1] === '"')) {
        return fail('string_prefix');
      }
      tokens.push({ kind: 'ident', value: word, start: i, end: j });
      i = j;
      continue;
    }
    if (isDigit(c) || (c === '.' && isDigit(text[i + 1] ?? ''))) {
      let j = i;
      while (j < text.length && isDigit(text.charAt(j))) j += 1;
      if (text[j] === '.' && text[j + 1] !== '.') {
        j += 1;
        while (j < text.length && isDigit(text.charAt(j))) j += 1;
      }
      if (text[j] === 'e' || text[j] === 'E') {
        let k = j + 1;
        if (text[k] === '+' || text[k] === '-') k += 1;
        if (isDigit(text[k] ?? '')) {
          j = k;
          while (j < text.length && isDigit(text.charAt(j))) j += 1;
        }
      }
      // `1abc`, `0x1F`, `1_000`: trailing junk after a number is not read.
      if (j < text.length && isIdentChar(text.charAt(j))) return fail('syntax');
      tokens.push({ kind: 'number', value: text.slice(i, j), start: i, end: j });
      i = j;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      let closed = false;
      while (j < text.length) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) return fail('syntax');
      if (j + 1 - i > MAX_STRING_LITERAL_CHARS) return fail('string_too_long');
      tokens.push({ kind: 'string', value: text.slice(i, j + 1), start: i, end: j + 1 });
      i = j + 1;
      continue;
    }
    if (c === '"') return fail('quoted_identifier');
    if (c === '$') return fail('dollar');
    if (c === ';') return fail('multiple_statements');
    if (c === '(' || c === ')' || c === ',' || c === '.') {
      tokens.push({ kind: 'punct', value: c, start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (c === ':') {
      if (text[i + 1] === ':') {
        tokens.push({ kind: 'punct', value: '::', start: i, end: i + 2 });
        i += 2;
        continue;
      }
      return fail('operator::');
    }
    if (OPERATOR_CHARS.has(c)) {
      let j = i;
      while (j < text.length && OPERATOR_CHARS.has(text.charAt(j))) j += 1;
      let op = text.slice(i, j);
      if (op.includes('--') || op.includes('/*')) return fail('comment');
      // Like the Postgres lexer: `=-1` is `=` then `-1`, unless the run holds a non-math char.
      while (op.length > 1 && /[+-]$/.test(op) && !NON_MATH_OPERATOR_CHARS.test(op)) {
        op = op.slice(0, -1);
      }
      if (!ALLOWED_OPERATORS.has(op)) return fail(`operator:${op}`);
      tokens.push({ kind: 'op', value: op, start: i, end: i + op.length });
      i += op.length;
      continue;
    }
    // `[`, `]`, `{`, `}`, `\`, and anything else.
    return fail(`operator:${c}`);
  }
  return { ok: true, tokens };
}

const isPunct = (t: Token | undefined, v: string): boolean => t?.kind === 'punct' && t.value === v;
const isWord = (t: Token | undefined, v: string): boolean => t?.kind === 'ident' && t.value === v;

/** CTE names: `with name as (`, `, name as (`, also `as [not] materialized (`. */
function cteNames(tokens: Token[]): Set<string> {
  const names = new Set<string>();
  for (const [i, t] of tokens.entries()) {
    if (i === 0 || t.kind !== 'ident' || !isWord(tokens[i + 1], 'as')) continue;
    if (!isWord(tokens[i - 1], 'with') && !isPunct(tokens[i - 1], ',')) continue;
    let k = i + 2;
    if (isWord(tokens[k], 'not')) k += 1;
    if (isWord(tokens[k], 'materialized')) k += 1;
    if (isPunct(tokens[k], '(')) names.add(t.value);
  }
  return names;
}

/**
 * Checks one query the model wrote. On success it returns the trimmed SQL (without a trailing
 * `;`), which runs unchanged, and the relations it reads. On failure the reason is a short code
 * such as `function_not_allowed:pg_sleep`, shown to the model as `sql_rejected:<reason>`.
 */
export function checkSql(text: string, opts: SqlGuardOptions): SqlGuardResult {
  // 1. Text.
  let sql = text.trim();
  if (sql.endsWith(';')) sql = sql.slice(0, -1).trimEnd();
  if (sql.length > MAX_SQL_CHARS) return fail('too_long');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(sql)) return fail('bad_chars');

  // 2. Tokens.
  const lexed = lex(sql);
  if (!lexed.ok) return lexed;
  const tokens = lexed.tokens;
  const first = tokens[0];
  if (!first) return fail('not_select');

  // 3. One SELECT or WITH … SELECT.
  if (!isWord(first, 'select') && !isWord(first, 'with')) return fail('not_select');
  // 4. Denied words and catalog names.
  for (const [i, t] of tokens.entries()) {
    if (t.kind !== 'ident') continue;
    if (DENIED_WORDS.has(t.value)) return fail(`keyword:${t.value}`);
    if (t.value.startsWith('pg_')) {
      // `pg_sleep(…)` reads better to the model as a function it may not call.
      if (isPunct(tokens[i + 1], '(')) return fail(`function_not_allowed:${t.value}`);
      return fail(`catalog:${t.value}`);
    }
  }

  // 5. Function calls.
  for (const [i, t] of tokens.entries()) {
    if (t.kind !== 'ident' || !isPunct(tokens[i + 1], '(')) continue;
    if (isPunct(tokens[i - 1], '.')) return fail('qualified_function');
    // A type name after `::` may take a modifier: `::numeric(12,2)`; step 6 checks the type.
    if (isPunct(tokens[i - 1], '::')) continue;
    if (PAREN_KEYWORDS.has(t.value)) continue;
    // `name as [not] materialized (…)`: a CTE body, not a call.
    if (
      t.value === 'materialized' &&
      (isWord(tokens[i - 1], 'as') || isWord(tokens[i - 1], 'not'))
    ) {
      continue;
    }
    if (t.value === 'cast') return fail('function_not_allowed:cast (use ::type)');
    if (!ALLOWED_FUNCTIONS.has(t.value)) return fail(`function_not_allowed:${t.value}`);
  }

  // 6. Casts and typed literals.
  for (const [i, t] of tokens.entries()) {
    if (isPunct(t, '::')) {
      const type = tokens[i + 1];
      if (type?.kind !== 'ident') return fail(`type_not_allowed:${type?.value ?? ''}`);
      if (type.value === 'double') {
        if (!isWord(tokens[i + 2], 'precision')) return fail('type_not_allowed:double');
        continue;
      }
      if (!CAST_TYPES.has(type.value)) return fail(`type_not_allowed:${type.value}`);
      continue;
    }
    if (t.kind === 'ident' && tokens[i + 1]?.kind === 'string') {
      if (EXPRESSION_KEYWORDS.has(t.value)) continue;
      if (!TYPED_LITERAL_TYPES.has(t.value)) return fail(`typed_literal:${t.value}`);
    }
  }

  // 7. Relations after FROM / JOIN, and after each comma of a FROM list.
  const ctes = cteNames(tokens);
  if (ctes.size > MAX_CTES) return fail('too_many_ctes');
  const seriesCalls = tokens.filter(
    (t, i) => isWord(t, 'generate_series') && isPunct(tokens[i + 1], '('),
  ).length;
  if (seriesCalls > MAX_GENERATE_SERIES) return fail('too_many_generate_series');
  const relations = new Set<string>();
  let fromItems = 0;
  /**
   * One frame per open parenthesis, plus the top level: the identifier before the parenthesis, if
   * any, and whether a FROM list is open at that level (so a comma there starts another item).
   */
  const frames: { before: string | null; inFrom: boolean }[] = [{ before: null, inFrom: false }];
  /** Checks the FROM item that starts at `tokens[k]`; returns a failure reason, or null. */
  const fromItem = (k: number): string | null => {
    fromItems += 1;
    if (fromItems > MAX_FROM_ITEMS) return 'too_many_relations';
    const next = tokens[k];
    if (isPunct(next, '(')) return null;
    if (next?.kind === 'ident') {
      if (RELATION_FUNCTIONS.has(next.value) && isPunct(tokens[k + 1], '(')) return null;
      if (opts.views.has(next.value) || ctes.has(next.value)) {
        relations.add(next.value);
        return null;
      }
    }
    return `unknown_view:${next?.value ?? ''}`;
  };
  for (const [i, t] of tokens.entries()) {
    if (isPunct(t, '(')) {
      const before = tokens[i - 1];
      frames.push({ before: before?.kind === 'ident' ? before.value : null, inFrom: false });
      continue;
    }
    if (isPunct(t, ')')) {
      frames.pop();
      if (frames.length === 0) return fail('unbalanced');
      continue;
    }
    const frame = frames.at(-1);
    if (!frame) return fail('unbalanced');
    if (isPunct(t, ',')) {
      if (!frame.inFrom) continue;
      const reason = fromItem(i + 1);
      if (reason) return fail(reason);
      continue;
    }
    if (t.kind !== 'ident') continue;
    if (FROM_END_WORDS.has(t.value)) {
      frame.inFrom = false;
      continue;
    }
    if (t.value !== 'from' && t.value !== 'join') continue;
    // `extract(dow from x)`, `trim(both 'a' from x)`: an argument, not a FROM clause.
    if (frame.before && ALLOWED_FUNCTIONS.has(frame.before)) continue;
    // `a is distinct from b`.
    if (t.value === 'from' && isWord(tokens[i - 1], 'distinct')) continue;
    frame.inFrom = true;
    const reason = fromItem(i + 1);
    if (reason) return fail(reason);
  }

  // 8. Shape.
  let depth = 0;
  for (const t of tokens) {
    if (isPunct(t, '(')) {
      depth += 1;
      if (depth > MAX_DEPTH) return fail('too_deep');
    } else if (isPunct(t, ')')) {
      depth -= 1;
      if (depth < 0) return fail('unbalanced');
    }
  }
  if (depth !== 0) return fail('unbalanced');
  if (tokens.length > MAX_TOKENS) return fail('too_long');

  return { ok: true, sql, relations: [...relations] };
}
