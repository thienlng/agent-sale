import type {
  AssistantChart as AssistantChartSpec,
  AssistantChartUnit,
} from '@agent-sales/contracts';
import { BarChart3, Table2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/button';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCompactVnd, formatDay, formatNumber, formatVnd } from '@/lib/format';

import { statusLabel } from '../utils/status-labels';

const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const PIE_COLORS = [...SERIES_COLORS, 'var(--chart-5)'];
const DAY = /^\d{4}-\d{2}-\d{2}/;

/** A full value: money as VND, a percentage with one decimal, any other number as is. */
function formatValue(unit: AssistantChartUnit, v: number): string {
  if (unit === 'vnd') return formatVnd(v);
  if (unit === 'percent') return `${formatNumber(v, 1)}%`;
  return formatNumber(v);
}

/** An axis tick: money in short form (1,3 tr), the rest as `formatValue`. */
function formatTick(unit: AssistantChartUnit, v: number): string {
  return unit === 'vnd' ? formatCompactVnd(v) : formatValue(unit, v);
}

/**
 * A category: a `yyyy-mm-dd…` value as a day, a raw status (`cancelled`) as its label, an empty
 * one as a dash.
 */
function formatCategory(t: (key: string) => string, v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const s = String(v);
  return DAY.test(s) ? formatDay(s.slice(0, 10)) : (statusLabel(t, s) ?? s);
}

/**
 * A chart inside an assistant answer (T-171). It is built by the server from the rows of a
 * read-only query and stored on the message, so a reopened thread shows it again. Series get
 * safe keys (`s0`…`s3`) because a column name may not be a valid CSS custom property. "Show table"
 * switches to the same rows as a table. Lazy-loaded so recharts loads only when a chart shows.
 */
export default function AssistantChart({ chart }: { chart: AssistantChartSpec }) {
  const { t } = useTranslation('assistant');
  const [asTable, setAsTable] = useState(false);
  const config: ChartConfig = Object.fromEntries(
    chart.series.map((s, i) => [
      `s${i}`,
      { label: s.label, color: SERIES_COLORS[i] ?? 'var(--chart-1)' },
    ]),
  );
  const data = chart.rows.map((row) => ({
    x: formatCategory(t, row[chart.x.key]),
    ...Object.fromEntries(
      chart.series.map((s, i) => {
        const v = row[s.key];
        return [`s${i}`, typeof v === 'number' ? v : null];
      }),
    ),
  }));
  const tooltip = (
    <ChartTooltip
      content={
        <ChartTooltipContent
          {...(chart.kind === 'pie' ? { nameKey: 'x', hideLabel: true } : {})}
          formatter={(value, name) => (
            <div className="flex flex-1 items-center justify-between gap-3 leading-none">
              <span className="text-muted-foreground">
                {chart.kind === 'pie' ? String(name) : (config[String(name)]?.label ?? name)}
              </span>
              <span className="font-mono font-medium text-foreground tabular-nums">
                {formatValue(chart.unit, Number(value))}
              </span>
            </div>
          )}
        />
      }
    />
  );
  const axes = (
    <>
      <CartesianGrid vertical={false} />
      <XAxis dataKey="x" tickLine={false} axisLine={false} tickMargin={8} minTickGap={12} />
      <YAxis
        tickLine={false}
        axisLine={false}
        width={56}
        tickFormatter={(v: number) => formatTick(chart.unit, v)}
      />
    </>
  );

  return (
    <figure className="flex w-full min-w-0 flex-col gap-2 rounded-lg border bg-background p-2">
      <figcaption className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{chart.title}</span>
        {chart.rows.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
          >
            {asTable ? <BarChart3 aria-hidden /> : <Table2 aria-hidden />}
            {asTable ? t('chart.showChart') : t('chart.showTable')}
          </Button>
        ) : null}
      </figcaption>
      {chart.rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{t('chart.empty')}</p>
      ) : asTable ? (
        <div className="max-h-[180px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{chart.x.label}</TableHead>
                {chart.series.map((s) => (
                  <TableHead key={s.key} className="text-right">
                    {s.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {chart.rows.map((row, i) => (
                <TableRow key={i}>
                  <TableCell>{formatCategory(t, row[chart.x.key])}</TableCell>
                  {chart.series.map((s) => {
                    const v = row[s.key];
                    return (
                      <TableCell key={s.key} className="text-right tabular-nums">
                        {typeof v === 'number' ? formatValue(chart.unit, v) : '—'}
                      </TableCell>
                    );
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <ChartContainer config={config} className="aspect-auto h-[180px] w-full">
          {chart.kind === 'pie' ? (
            <PieChart>
              {tooltip}
              <Pie data={data} dataKey="s0" nameKey="x" isAnimationActive={false}>
                {data.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length] ?? 'var(--chart-1)'} />
                ))}
              </Pie>
            </PieChart>
          ) : chart.kind === 'line' ? (
            <LineChart data={data} margin={{ left: 4, right: 4 }}>
              {axes}
              {tooltip}
              {chart.series.map((_, i) => (
                <Line
                  key={i}
                  type="linear"
                  dataKey={`s${i}`}
                  stroke={`var(--color-s${i})`}
                  strokeWidth={2}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          ) : (
            <BarChart data={data} margin={{ left: 4, right: 4 }}>
              {axes}
              {tooltip}
              {chart.series.map((_, i) => (
                <Bar
                  key={i}
                  dataKey={`s${i}`}
                  fill={`var(--color-s${i})`}
                  radius={2}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          )}
        </ChartContainer>
      )}
    </figure>
  );
}
