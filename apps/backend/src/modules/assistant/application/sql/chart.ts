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
 * Errors: `chart_unknown_column:<c>`, `chart_duplicate_column:<c>`, `chart_bad_pie`,
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
    const out: Record<string, string | number | null> = {
      [req.x]: xCell === null ? null : cut(String(xCell), MAX_CHART_CELL_CHARS),
    };
    for (const y of req.y) out[y] = (row[at(y)] ?? null) as number | null;
    return out;
  });
  const label = (key: string) => ({
    key,
    label: cut(req.labels?.[key] ?? key, MAX_LABEL_CHARS),
  });
  return {
    ok: true,
    chart: {
      kind: req.kind,
      title: req.title,
      x: label(req.x),
      series: req.y.map(label),
      unit: req.unit ?? 'number',
      rows,
    },
  };
}
