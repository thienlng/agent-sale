import type { OrderOverviewResponse } from '@agent-sales/contracts';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import { DateRangePicker, type IsoRange, presetRange } from '@/components/date-range-picker';
import { Button } from '@/components/ui/button';
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCompactVnd, formatDate, formatNumber, formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useOrderOverview } from '../api/commerce';

type Kpi = keyof OrderOverviewResponse['kpis'];
type SeriesKey = 'sales' | 'revenue' | 'profit' | 'closedOrders' | 'productQty';

const KPIS: Array<{ key: Kpi; money: boolean; series?: SeriesKey }> = [
  { key: 'sales', money: true, series: 'sales' },
  { key: 'revenue', money: true, series: 'revenue' },
  { key: 'profit', money: true, series: 'profit' },
  { key: 'closedOrders', money: false, series: 'closedOrders' },
  { key: 'avgOrderValue', money: true },
  { key: 'productQty', money: false, series: 'productQty' },
  { key: 'avgProductsPerOrder', money: false },
  { key: 'avgProfitPerOrder', money: true },
];

const fmt = (money: boolean, v: number, digits = 0) =>
  money ? formatVnd(v) : formatNumber(v, digits);

/** Order overview (ORD-11). Figures come from the same orders as the list. */
export function OrdersOverview() {
  const { t } = useTranslation();
  const [range, setRange] = useState<IsoRange>(() => presetRange('monthToDate'));
  const [metric, setMetric] = useState<SeriesKey>('sales');
  const overview = useOrderOverview(range);
  const data = overview.data;
  const metricIsMoney = KPIS.find((k) => k.series === metric)?.money ?? true;
  const chartConfig = {
    value: { label: t(`overview.kpi.${metric}`), color: 'var(--chart-1)' },
  } satisfies ChartConfig;
  const hourConfig = {
    revenue: { label: t('overview.todayRevenue'), color: 'var(--chart-1)' },
  } satisfies ChartConfig;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('overview.title')}</h1>
        <div className="flex flex-wrap items-center gap-2">
          {data ? (
            <span className="text-xs text-muted-foreground">
              {t('overview.updatedAt', { time: new Date(data.generatedAt).toLocaleTimeString() })}
            </span>
          ) : null}
          <DateRangePicker value={range} onChange={(r) => r && setRange(r)} />
          <Button
            variant="outline"
            size="icon"
            aria-label={t('overview.reload')}
            title={t('overview.reload')}
            onClick={() => void overview.refetch()}
          >
            <RefreshCw className={cn(overview.isFetching && 'animate-spin')} />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((k) => {
          const selectable = Boolean(k.series);
          const active = k.series === metric;
          const value = data?.kpis[k.key];
          return (
            <button
              key={k.key}
              type="button"
              disabled={!selectable}
              aria-pressed={selectable ? active : undefined}
              onClick={() => k.series && setMetric(k.series)}
              className={cn(
                'flex flex-col items-start gap-1 rounded-xl border bg-card p-4 text-left transition-colors',
                selectable &&
                  'hover:border-primary/60 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none',
                active && 'border-primary bg-primary-soft',
                !selectable && 'cursor-default',
              )}
            >
              <span className="text-sm text-muted-foreground">{t(`overview.kpi.${k.key}`)}</span>
              {value === undefined ? (
                <Skeleton className="h-7 w-24" />
              ) : (
                <span className="truncate text-xl font-semibold tabular-nums">
                  {fmt(k.money, value, k.key === 'avgProductsPerOrder' ? 1 : 0)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-xl border bg-card p-4 md:p-5">
          <h2 className="font-semibold">{t(`overview.kpi.${metric}`)}</h2>
          <p className="text-sm text-muted-foreground">{t('overview.chartHint')}</p>
          {data ? (
            <ChartContainer config={chartConfig} className="mt-4 aspect-auto h-64 w-full">
              <BarChart
                data={data.series.map((d) => ({ date: d.date, value: d[metric] }))}
                margin={{ left: 4, right: 4 }}
              >
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={16}
                  tickFormatter={formatDate}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={52}
                  tickFormatter={(v: number) =>
                    metricIsMoney ? formatCompactVnd(v) : formatNumber(v)
                  }
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(_, payload) =>
                        formatDate(String(payload?.[0]?.payload?.date ?? ''))
                      }
                      formatter={(v) => fmt(metricIsMoney, Number(v))}
                    />
                  }
                />
                <Bar dataKey="value" fill="var(--color-value)" radius={4} />
              </BarChart>
            </ChartContainer>
          ) : (
            <Skeleton className="mt-4 h-64" />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {(
            [
              ['closedGoods', data?.closed],
              ['returnedGoods', data?.returned],
            ] as const
          ).map(([key, block]) => (
            <div key={key} className="rounded-xl border bg-card p-4">
              <h2 className="font-semibold">{t(`overview.${key}`)}</h2>
              <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>
                  <dt className="text-muted-foreground">{t('overview.amount')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {block ? formatVnd(block.amount) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t('overview.qty')}</dt>
                  <dd className="text-lg font-semibold tabular-nums">
                    {block ? formatNumber(block.productQty) : '—'}
                  </dd>
                </div>
              </dl>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4 md:p-5">
        <h2 className="font-semibold">{t('overview.today')}</h2>
        <div className="mt-4 grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <dl className="grid grid-cols-2 gap-3 self-start">
            {(
              [
                ['todayRevenue', data?.today.revenue, true],
                ['todayClosed', data?.today.closedOrders, false],
                ['todayCreated', data?.today.created, false],
                ['todayCancelled', data?.today.cancelled, false],
                ['todayQty', data?.today.productQty, false],
              ] as const
            ).map(([key, value, money]) => (
              <div key={key} className="rounded-lg bg-muted/50 p-3">
                <dt className="text-xs text-muted-foreground">{t(`overview.${key}`)}</dt>
                <dd className="mt-0.5 font-semibold tabular-nums">
                  {value === undefined ? '—' : fmt(money, value)}
                </dd>
              </div>
            ))}
          </dl>
          <div className="min-w-0">
            <div className="text-sm text-muted-foreground">{t('overview.byHour')}</div>
            {data ? (
              <ChartContainer config={hourConfig} className="mt-2 aspect-auto h-48 w-full">
                <BarChart data={data.today.byHour}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="hour"
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(h: number) => `${h}h`}
                    interval={2}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    tickFormatter={(v: number) => formatCompactVnd(v)}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent formatter={(v) => formatVnd(Number(v))} />}
                  />
                  <Bar dataKey="revenue" fill="var(--color-revenue)" radius={3} />
                </BarChart>
              </ChartContainer>
            ) : (
              <Skeleton className="mt-2 h-48" />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
