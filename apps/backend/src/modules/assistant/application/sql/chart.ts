import {
  ASSISTANT_PIE_MAX_ROWS,
  type AssistantChart,
  AssistantChartUnit,
} from '@agent-sales/contracts';
import { z } from 'zod';

import type { SqlRunResult } from '../../domain/ports/sql-runner.port.js';

/**
 * The `chart` argument of `sql_query` (spec §8): which result columns to draw. The model names
 * columns only; the numbers always come from the query's own rows (ruling 2-R6).
 */
export const ChartRequest = z.object({
  kind: z.enum(['bar', 'line', 'pie']),
  title: z.string().trim().min(1).max(120),
  x: z.string().max(63),
  y: z.array(z.string().max(63)).min(1).max(4),
  unit: AssistantChartUnit.optional(),
  labels: z.record(z.string().max(63), z.string().max(60)).optional(),
});
export type ChartRequest = z.output<typeof ChartRequest>;

export const MAX_CHARTS_PER_TURN = 3;
/** Most points a bar or line chart shows (a pie shows at most `ASSISTANT_PIE_MAX_ROWS`). */
export const MAX_CHART_ROWS = 60;
export const MAX_CHART_CELL_CHARS = 80;
const MAX_LABEL_CHARS = 60;

/**
 * Vietnamese axis and series labels for the column names the SQL views and the model's queries
 * use, when the model gives no `labels` (staging NEW-4: the owner saw "day" and "orders").
 */
const COLUMN_LABELS: Record<string, string> = {
  day: 'Ngày',
  date: 'Ngày',
  ngay: 'Ngày',
  week: 'Tuần',
  month: 'Tháng',
  hour: 'Giờ',
  orders: 'Số đơn',
  order_count: 'Số đơn',
  orders_count: 'Số đơn',
  revenue: 'Doanh thu',
  total_revenue: 'Doanh thu',
  sales: 'Doanh số',
  profit: 'Lợi nhuận',
  units: 'Số lượng',
  units_sold: 'Số lượng bán',
  qty: 'Số lượng',
  quantity: 'Số lượng',
  product: 'Sản phẩm',
  product_name: 'Sản phẩm',
  customers: 'Số khách',
  customer_count: 'Số khách',
  new_customers: 'Khách mới',
  conversations: 'Hội thoại',
  messages: 'Tin nhắn',
  nights: 'Số đêm',
  bookings: 'Số booking',
  property_name: 'Căn',
  source: 'Nguồn',
  channel: 'Kênh',
  status: 'Trạng thái',
  status_name: 'Trạng thái',
  category: 'Danh mục',
  count: 'Số lượng',
  n: 'Số lượng',
  total: 'Tổng',
};

/** The label of a column without a model label: the known Vietnamese one, else the name spaced. */
export function defaultColumnLabel(key: string): string {
  const known = COLUMN_LABELS[key.toLowerCase()];
  if (known) return known;
  const spaced = key.replace(/_+/g, ' ').trim();
  return spaced ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

export type BuildChartResult =
  { ok: true; chart: AssistantChart } | { ok: false; errorCode: string };

/** At most `max` UTF-16 units, never ending inside a surrogate pair. */
const cut = (text: string, max: number): string => {
  if (text.length <= max) return text;
  const head = text.slice(0, max);
  const last = head.charCodeAt(head.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? head.slice(0, -1) : head;
};

/**
 * Builds a chart from the **full** fetched rows of a query (never the cut view the model reads).
 * Errors: `chart_unknown_column:<c>`, `chart_duplicate_column:<c>`, `chart_reserved_column:<c>`
 * (`__proto__`, which a plain object row would drop silently), `chart_bad_pie`,
 * `chart_needs_full_result`, `chart_empty`, `chart_too_many_points`, `chart_not_numeric:<c>`.
 */
export function buildChart(req: ChartRequest, result: SqlRunResult): BuildChartResult {
  const fail = (errorCode: string): BuildChartResult => ({ ok: false, errorCode });
  // The first column of a name wins, as in the model's view of the rows.
  const index = new Map<string, number>();
  result.columns.forEach((c, i) => {
    if (!index.has(c.name)) index.set(c.name, i);
  });

  for (const c of [req.x, ...req.y]) {
    if (c === '__proto__') return fail(`chart_reserved_column:${c}`);
    if (!index.has(c)) return fail(`chart_unknown_column:${c}`);
  }
  // Every name is known from here on.
  const at = (c: string): number => index.get(c) ?? -1;
  const seen = new Set<string>();
  for (const c of [req.x, ...req.y]) {
    if (seen.has(c)) return fail(`chart_duplicate_column:${c}`);
    seen.add(c);
  }
  if (req.kind === 'pie' && req.y.length !== 1) return fail('chart_bad_pie');
  if (result.truncated) return fail('chart_needs_full_result');
  if (result.rows.length === 0) return fail('chart_empty');
  const maxRows = req.kind === 'pie' ? ASSISTANT_PIE_MAX_ROWS : MAX_CHART_ROWS;
  if (result.rows.length > maxRows) return fail('chart_too_many_points');

  for (const y of req.y) {
    const i = at(y);
    if (result.columns[i]?.type !== 'number') return fail(`chart_not_numeric:${y}`);
    for (const row of result.rows) {
      const cell = row[i] ?? null;
      if (cell === null) continue;
      if (typeof cell !== 'number' || !Number.isFinite(cell)) return fail(`chart_not_numeric:${y}`);
      if (req.kind === 'pie' && cell < 0) return fail('chart_bad_pie');
    }
  }

  const xi = at(req.x);
  const rows = result.rows.map((row) => {
    const xCell = row[xi] ?? null;
    const out: ChartRow = {
      [req.x]: xCell === null ? null : cut(String(xCell), MAX_CHART_CELL_CHARS),
    };
    for (const y of req.y) out[y] = (row[at(y)] ?? null) as number | null;
    return out;
  });
  const series = req.kind === 'pie' ? rows : dateSeries(rows, req.x, req.y);
  if (series.length > maxRows) return fail('chart_too_many_points');
  const label = (key: string) => ({
    key,
    label: cut(req.labels?.[key] ?? defaultColumnLabel(key), MAX_LABEL_CHARS),
  });
  return {
    ok: true,
    chart: {
      kind: req.kind,
      title: req.title,
      x: label(req.x),
      series: req.y.map(label),
      unit: req.unit ?? 'number',
      rows: series,
    },
  };
}

type ChartRow = Record<string, string | number | null>;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]00:00(?::00)?(?:[+-]\d{2}(?::?\d{2})?|Z)?)?$/;
const DAY_MS = 86_400_000;

/**
 * A date series as the owner reads it (AS2-5, AS2-10): when every x is a calendar date, the
 * missing days between the first and the last are added with 0 (a day without orders is a
 * point, not a gap), and a series of first days of months becomes `Tháng 10/2026` per month,
 * with the missing months added too. Anything else is returned as is. Rows stay in date order.
 */
export function dateSeries(rows: ChartRow[], x: string, ys: readonly string[]): ChartRow[] {
  const parts: { at: number; first: boolean }[] = [];
  for (const r of rows) {
    const d = DAY_RE.exec(String(r[x] ?? ''));
    if (!d) return rows;
    parts.push({
      at: Date.UTC(Number(d[1]), Number(d[2]) - 1, Number(d[3])),
      first: d[3] === '01',
    });
  }
  if (rows.length < 2) return rows;
  const byKey = new Map<number, ChartRow>();
  rows.forEach((r, i) => byKey.set(parts[i]?.at ?? 0, r));
  const point = (key: number, xValue: string): ChartRow => {
    const found = byKey.get(key);
    const out: ChartRow = { [x]: xValue };
    for (const y of ys) out[y] = found ? (found[y] ?? null) : 0;
    return out;
  };
  const times = parts.map((p) => p.at);
  const first = Math.min(...times);
  const last = Math.max(...times);
  const out: ChartRow[] = [];
  if (parts.every((p) => p.first)) {
    const start = new Date(first);
    for (let m = 0; out.length <= MAX_CHART_ROWS; m++) {
      const key = Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m, 1);
      if (key > last) break;
      const d = new Date(key);
      out.push(point(key, `Tháng ${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`));
    }
    return out;
  }
  for (let key = first; key <= last && out.length <= MAX_CHART_ROWS; key += DAY_MS) {
    out.push(point(key, new Date(key).toISOString().slice(0, 10)));
  }
  return out;
}

/** A line that only stands in for a chart: `[Biểu đồ …]`, `[Chart: …]`, `*(biểu đồ bên dưới)*`. */
const CHART_PLACEHOLDER_LINE =
  /^\s*[*_]*[[(](?:biểu đồ|bieu do|chart)(?=[\s:\])])[^\])]*[\])][*_]*\s*$/iu;

/**
 * The answer without the placeholder lines a model writes where its chart goes (NEW-4): the app
 * draws the chart under the answer, so such a line only shows as raw text. Pure.
 */
export function withoutChartPlaceholders(text: string): string {
  return text
    .split('\n')
    .filter((line) => !CHART_PLACEHOLDER_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
