import { AssistantChart } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { buildChart, type ChartRequest } from '../application/sql/chart.js';
import type { SqlRunResult } from '../domain/ports/sql-runner.port.js';

const DAYS = [
  '2026-10-27',
  '2026-10-28',
  '2026-10-29',
  '2026-10-30',
  '2026-10-31',
  '2026-11-01',
  '2026-11-02',
];

const daily = (over: Partial<SqlRunResult> = {}): SqlRunResult => ({
  columns: [
    { name: 'day', type: 'text' },
    { name: 'revenue', type: 'number' },
    { name: 'orders', type: 'number' },
    { name: 'note', type: 'text' },
  ],
  rows: DAYS.map((d, i) => [d, (i + 1) * 100_000, i + 1, 'x']),
  truncated: false,
  ...over,
});

const bar = (over: Partial<ChartRequest> = {}): ChartRequest => ({
  kind: 'bar',
  title: 'Doanh thu 7 ngày',
  x: 'day',
  y: ['revenue'],
  ...over,
});

const error = (req: ChartRequest, result: SqlRunResult) => {
  const out = buildChart(req, result);
  return out.ok ? null : out.errorCode;
};

describe('buildChart', () => {
  it('builds a bar chart of 7 days that parses as an AssistantChart', () => {
    const out = buildChart(
      bar({ unit: 'vnd', labels: { day: 'Ngày', revenue: 'Doanh thu' } }),
      daily(),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.chart).toEqual({
      kind: 'bar',
      title: 'Doanh thu 7 ngày',
      x: { key: 'day', label: 'Ngày' },
      series: [{ key: 'revenue', label: 'Doanh thu' }],
      unit: 'vnd',
      rows: DAYS.map((d, i) => ({ day: d, revenue: (i + 1) * 100_000 })),
    });
    expect(AssistantChart.safeParse(out.chart).success).toBe(true);
  });

  it('defaults the labels to the column names and the unit to number', () => {
    const out = buildChart(bar({ kind: 'line', y: ['revenue', 'orders'] }), daily());
    if (!out.ok) throw new Error(out.errorCode);
    expect(out.chart.x).toEqual({ key: 'day', label: 'day' });
    expect(out.chart.series).toEqual([
      { key: 'revenue', label: 'revenue' },
      { key: 'orders', label: 'orders' },
    ]);
    expect(out.chart.unit).toBe('number');
    // Only the x and y columns are kept.
    expect(Object.keys(out.chart.rows[0]!)).toEqual(['day', 'revenue', 'orders']);
    expect(AssistantChart.safeParse(out.chart).success).toBe(true);
  });

  it('builds a pie chart', () => {
    const result: SqlRunResult = {
      columns: [
        { name: 'source', type: 'text' },
        { name: 'n', type: 'number' },
      ],
      rows: [
        ['Facebook', 12],
        ['Zalo', 5],
        [null, 0],
      ],
      truncated: false,
    };
    const out = buildChart(
      { kind: 'pie', title: 'Khách mới', x: 'source', y: ['n'], unit: 'count' },
      result,
    );
    if (!out.ok) throw new Error(out.errorCode);
    expect(out.chart.rows).toEqual([
      { source: 'Facebook', n: 12 },
      { source: 'Zalo', n: 5 },
      { source: null, n: 0 },
    ]);
    expect(AssistantChart.safeParse(out.chart).success).toBe(true);
  });

  it('cuts x cells to 80 chars and stringifies non-text x values', () => {
    const result: SqlRunResult = {
      columns: [
        { name: 'name', type: 'text' },
        { name: 'qty', type: 'number' },
      ],
      rows: [
        ['a'.repeat(200), 1],
        [42, 2],
        [true, null],
      ],
      truncated: false,
    };
    const out = buildChart(bar({ x: 'name', y: ['qty'] }), result);
    if (!out.ok) throw new Error(out.errorCode);
    expect(out.chart.rows).toEqual([
      { name: 'a'.repeat(80), qty: 1 },
      { name: '42', qty: 2 },
      { name: 'true', qty: null },
    ]);
    expect(AssistantChart.safeParse(out.chart).success).toBe(true);
  });

  it('cuts a long default label to 60 chars', () => {
    const col = 'c'.repeat(63);
    const out = buildChart(bar({ y: [col] }), {
      columns: [
        { name: 'day', type: 'text' },
        { name: col, type: 'number' },
      ],
      rows: [['2026-11-02', 1]],
      truncated: false,
    });
    if (!out.ok) throw new Error(out.errorCode);
    expect(out.chart.series[0]!.label).toBe('c'.repeat(60));
    expect(AssistantChart.safeParse(out.chart).success).toBe(true);
  });

  it('builds from the full rows even when the model view was cut', () => {
    // 60 rows with long text: the model reads fewer rows (8 000-char cap), the chart has all 60.
    const result: SqlRunResult = {
      columns: [
        { name: 'name', type: 'text' },
        { name: 'qty', type: 'number' },
      ],
      rows: Array.from({ length: 60 }, (_, i) => [`${'p'.repeat(190)}${i}`, i]),
      truncated: false,
    };
    const out = buildChart(bar({ x: 'name', y: ['qty'] }), result);
    if (!out.ok) throw new Error(out.errorCode);
    expect(out.chart.rows).toHaveLength(60);
    expect(out.chart.rows[59]).toEqual({ name: 'p'.repeat(80), qty: 59 });
  });

  it('returns every error code', () => {
    expect(error(bar({ x: 'nope' }), daily())).toBe('chart_unknown_column:nope');
    expect(error(bar({ y: ['revenue', 'gone'] }), daily())).toBe('chart_unknown_column:gone');
    expect(error(bar({ y: ['revenue', 'revenue'] }), daily())).toBe(
      'chart_duplicate_column:revenue',
    );
    expect(error(bar({ y: ['note'] }), daily())).toBe('chart_not_numeric:note');
    expect(error(bar(), daily({ rows: [['2026-11-02', '9007199254740993', 1, 'x']] }))).toBe(
      'chart_not_numeric:revenue',
    );
    expect(error(bar(), daily({ truncated: true }))).toBe('chart_needs_full_result');
    expect(error(bar(), daily({ rows: [] }))).toBe('chart_empty');
    const many = Array.from({ length: 61 }, (_, i) => [`d${i}`, i, i, 'x']);
    expect(error(bar(), daily({ rows: many }))).toBe('chart_too_many_points');
    expect(error(bar(), daily({ rows: many.slice(0, 60) }))).toBeNull();
    expect(error(bar({ kind: 'pie' }), daily({ rows: many.slice(0, 13) }))).toBe(
      'chart_too_many_points',
    );
    expect(error(bar({ kind: 'pie' }), daily({ rows: many.slice(0, 12) }))).toBeNull();
    expect(error(bar({ kind: 'pie', y: ['revenue', 'orders'] }), daily())).toBe('chart_bad_pie');
    expect(error(bar({ kind: 'pie' }), daily({ rows: [['a', -1, 1, 'x']] }))).toBe('chart_bad_pie');
    // A negative value is fine on a bar chart.
    expect(error(bar(), daily({ rows: [['a', -1, 1, 'x']] }))).toBeNull();
  });
});
