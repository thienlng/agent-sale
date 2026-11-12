import { AssistantChart } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import {
  buildChart,
  type ChartRequest,
  dateSeries,
  defaultColumnLabel,
  withoutChartPlaceholders,
} from '../application/sql/chart.js';
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

  it('defaults the labels to Vietnamese names of the columns and the unit to number (NEW-4)', () => {
    const out = buildChart(bar({ kind: 'line', y: ['revenue', 'orders'] }), daily());
    if (!out.ok) throw new Error(out.errorCode);
    expect(out.chart.x).toEqual({ key: 'day', label: 'Ngày' });
    expect(out.chart.series).toEqual([
      { key: 'revenue', label: 'Doanh thu' },
      { key: 'orders', label: 'Số đơn' },
    ]);
    expect(defaultColumnLabel('gross_margin')).toBe('Gross margin');
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
    expect(out.chart.series[0]!.label).toBe(`C${'c'.repeat(59)}`);
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
    // A `__proto__` alias would vanish from a plain object row: refused, never dropped silently.
    const proto = daily({
      columns: [
        { name: 'day', type: 'text' },
        { name: '__proto__', type: 'number' },
      ],
      rows: [['2026-11-02', 1]],
    });
    expect(error(bar({ y: ['__proto__'] }), proto)).toBe('chart_reserved_column:__proto__');
    expect(error(bar({ x: '__proto__', y: ['day'] }), proto)).toBe(
      'chart_reserved_column:__proto__',
    );
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

describe('withoutChartPlaceholders (NEW-4)', () => {
  it('drops the line a model writes where its chart goes, and keeps the rest', () => {
    expect(
      withoutChartPlaceholders(
        'Biểu đồ số đơn mỗi ngày trong 30 ngày qua:\n\n[Biểu đồ số đơn theo ngày — 30 ngày qua]\n\nTổng 4 đơn.',
      ),
    ).toBe('Biểu đồ số đơn mỗi ngày trong 30 ngày qua:\n\nTổng 4 đơn.');
    expect(withoutChartPlaceholders('A\n*(Chart: orders)*\nB')).toBe('A\nB');
    // A link or a bracket inside a sentence stays.
    const kept = 'Xem [Đơn hàng](/app/orders) và [biểu đồ] trong câu.';
    expect(withoutChartPlaceholders(kept)).toBe(kept);
  });
});

describe('dateSeries (AS2-5, AS2-10)', () => {
  it('adds the days without orders as 0, between the first and the last day', () => {
    expect(
      dateSeries(
        [
          { day: '2026-10-30', orders: 4 },
          { day: '2026-11-02', orders: 3 },
        ],
        'day',
        ['orders'],
      ),
    ).toEqual([
      { day: '2026-10-30', orders: 4 },
      { day: '2026-10-31', orders: 0 },
      { day: '2026-11-01', orders: 0 },
      { day: '2026-11-02', orders: 3 },
    ]);
  });

  it('names months in Vietnamese and fills the missing ones', () => {
    expect(
      dateSeries(
        [
          { month: '2026-08-01 00:00:00+07', revenue: 1 },
          { month: '2026-10-01 00:00:00+07', revenue: 3 },
        ],
        'month',
        ['revenue'],
      ),
    ).toEqual([
      { month: 'Tháng 8/2026', revenue: 1 },
      { month: 'Tháng 9/2026', revenue: 0 },
      { month: 'Tháng 10/2026', revenue: 3 },
    ]);
  });

  it('leaves other categories alone', () => {
    const rows = [
      { name: 'Áo', n: 1 },
      { name: 'Quần', n: 2 },
    ];
    expect(dateSeries(rows, 'name', ['n'])).toBe(rows);
  });
});
