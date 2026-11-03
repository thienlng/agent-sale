/**
 * The closed list of import transforms and the field readers (T-173, spec §5.1). Pure: every
 * transform is a fixed function; nothing the model writes is evaluated.
 */
import {
  CODE_MAX,
  CODE_RULE,
  IMPORT_MAX_DATA_ROWS,
  VARIANT_NAME_COLUMNS,
  type ImportSpec,
  STOCK_MAX,
  WEIGHT_MAX,
  type ImportSource,
  type ImportTransform,
  type ProblemCode,
} from './product-import.schema.js';
import { parseMoneyVnd, parseNumberVi, parseWeightGrams } from './vi-number.js';

// ─── Transforms ───────────────────────────────────────────────────────────────

export type Value = string | number;
/** `bad` marks a value a parsing transform could not read. */
export type Evaluated = { value: Value; bad: boolean };

export function isEmpty(v: Value): boolean {
  return typeof v === 'string' && v.trim() === '';
}

export function codeOf(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._\-/]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CODE_MAX);
}

function titleCase(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('vi')
    .replace(/(^|[\s(/-])(\p{L})/gu, (_, before: string, letter: string) => {
      return before + letter.toLocaleUpperCase('vi');
    });
}

function applyTransform(e: Evaluated, t: ImportTransform): Evaluated {
  if (e.bad) return e;
  const { value } = e;
  if (typeof t === 'object') {
    if ('default' in t) return isEmpty(value) ? { value: t.default, bad: false } : e;
    const hit = t.map[String(value).trim()];
    return hit === undefined ? e : { value: hit, bad: false };
  }
  if (isEmpty(value)) return { value: '', bad: false };
  const text = String(value);
  switch (t) {
    case 'trim':
      return { value: text.trim(), bad: false };
    case 'collapse_spaces':
      return { value: text.replace(/\s+/g, ' ').trim(), bad: false };
    case 'upper':
      return { value: text.toLocaleUpperCase('vi'), bad: false };
    case 'lower':
      return { value: text.toLocaleLowerCase('vi'), bad: false };
    case 'title':
      return { value: titleCase(text), bad: false };
    case 'code':
      return { value: codeOf(text), bad: false };
    case 'money_vnd': {
      const n = parseMoneyVnd(value);
      return n === null ? { value, bad: true } : { value: n, bad: false };
    }
    case 'weight_grams': {
      const n = parseWeightGrams(value);
      return n === null ? { value, bad: true } : { value: n, bad: false };
    }
    case 'number_vi': {
      const n = typeof value === 'number' ? value : parseNumberVi(text);
      return Number.isFinite(n) ? { value: n, bad: false } : { value, bad: true };
    }
  }
}

export function cell(row: readonly string[] | undefined, col: number): string {
  return row?.[col] ?? '';
}

export function evaluate(source: ImportSource, row: readonly string[] | undefined): Evaluated {
  let value: Value;
  if ('col' in source) value = cell(row, source.col);
  else if ('const' in source) value = source.const;
  else
    value = source.concat
      .map((c) => cell(row, c).trim())
      .filter((v) => v !== '')
      .join(source.sep ?? ' ');
  let e: Evaluated = { value, bad: false };
  for (const t of source.transforms ?? []) e = applyTransform(e, t);
  return e;
}

export function columnsOf(source: ImportSource | undefined): number[] {
  if (!source) return [];
  if ('col' in source) return [source.col];
  if ('concat' in source) return source.concat;
  return [];
}

// ─── Field validation ─────────────────────────────────────────────────────────

export interface Sink {
  add(field: string, code: ProblemCode, row?: number): void;
}

export function text(e: Evaluated | undefined): string {
  if (!e || e.bad) return '';
  return String(e.value).trim();
}

export function cut(value: string, max: number, field: string, sink: Sink, row?: number): string {
  if (value.length <= max) return value;
  sink.add(field, `cut:${field}`, row);
  return value.slice(0, max).trim();
}

export type NumericField = 'price' | 'cost' | 'weightGram' | 'stock';

/** Reads a numeric field: a string goes through the field's own parser; null when empty. */
export function numeric(
  field: NumericField,
  e: { value: Value | null; bad: boolean } | undefined,
): { value: number | null; bad: boolean } {
  if (!e || e.value === null || (!e.bad && isEmpty(e.value))) return { value: null, bad: false };
  if (e.bad) return { value: null, bad: true };
  const raw = e.value;
  let n: number | null;
  if (field === 'price' || field === 'cost') n = parseMoneyVnd(raw);
  else if (field === 'weightGram') {
    n = parseWeightGrams(raw);
    if (n !== null && n > WEIGHT_MAX) n = null;
  } else {
    const v = typeof raw === 'number' ? raw : parseNumberVi(raw);
    n = Number.isInteger(v) && v >= 0 && v <= STOCK_MAX ? v : null;
  }
  return n === null ? { value: null, bad: true } : { value: n, bad: false };
}

export const NUMERIC_BAD: Record<NumericField, ProblemCode> = {
  price: 'bad_price',
  cost: 'bad_cost',
  weightGram: 'bad_weight',
  stock: 'bad_stock',
};

/** The contract's Code rule: letters, digits and . _ - / only, at most 64 chars. */
export function validCode(code: string): boolean {
  return code.length <= CODE_MAX && CODE_RULE.test(code);
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

export function dataRows(rows: string[][], spec: ImportSpec): number[] {
  const skip = new Set(spec.skipRows ?? []);
  const out: number[] = [];
  for (let i = spec.headerRow + 1; i < rows.length && out.length < IMPORT_MAX_DATA_ROWS; i++) {
    if (skip.has(i)) continue;
    if ((rows[i] ?? []).every((c) => c.trim() === '')) continue;
    out.push(i);
  }
  return out;
}

export function groupRows(rows: string[][], indexes: number[], spec: ImportSpec): number[][] {
  if (!spec.groupBy) return indexes.map((i) => [i]);
  const col = spec.groupBy.col;
  const groups = new Map<string, number[]>();
  const out: number[][] = [];
  for (const i of indexes) {
    const key = cell(rows[i], col).trim();
    if (key === '') {
      out.push([i]);
      continue;
    }
    const group = groups.get(key);
    if (group) group.push(i);
    else {
      const fresh = [i];
      groups.set(key, fresh);
      out.push(fresh);
    }
  }
  return out;
}

/** Unmapped columns whose values differ across the group's rows (≤ 3, header order). */
export function differingColumns(rows: string[][], group: number[], used: Set<number>): number[] {
  if (group.length < 2) return [];
  const width = Math.max(...group.map((i) => rows[i]?.length ?? 0));
  const out: number[] = [];
  for (let c = 0; c < width && out.length < VARIANT_NAME_COLUMNS; c++) {
    if (used.has(c)) continue;
    const values = new Set(group.map((i) => cell(rows[i], c).trim()));
    if (values.size > 1) out.push(c);
  }
  return out;
}
