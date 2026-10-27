import type { AnalyticsResponse, MetricKey } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { usePages } from '../api/analytics';
import { MultiSelect } from './multi-select';

import { Label } from '@/components/ui/label';
import { formatDate, formatNumber } from '@/lib/format';

/** One event metric per day of the range, zero-filled by the server (a day with nothing is a real 0). */
export function DailyChart({
  series,
  metrics,
  pages,
  onPagesChange,
}: {
  series: AnalyticsResponse['series'];
  metrics: readonly MetricKey[];
  pages?: string[];
  onPagesChange?: (pages: string[]) => void;
}) {
  const { t, i18n } = useTranslation();
  const channels = usePages(Boolean(onPagesChange));
  const [chosen, setChosen] = useState<MetricKey | undefined>(undefined);
  const metric = chosen && metrics.includes(chosen) ? chosen : metrics[0];
  if (!metric) return null;
  const config = {
    value: { label: t(`analytics.metrics.${metric}.name`), color: 'var(--chart-1)' },
  } satisfies ChartConfig;
  const data = series.map((p) => ({ date: p.date, value: p.values[metric] ?? 0 }));
  return (
    <section className="rounded-lg border p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-semibold">{t('analytics.chart.title')}</h2>
        <div className="flex items-center gap-2">
          <Label htmlFor="chart-metric" className="text-sm text-muted-foreground">
            {t('analytics.chart.metric')}
          </Label>
          <select
            id="chart-metric"
            className="h-9 max-w-56 rounded-md border bg-background px-2 text-sm"
            value={metric}
            onChange={(e) => setChosen(e.target.value as MetricKey)}
          >
            {metrics.map((m) => (
              <option key={m} value={m}>
                {t(`analytics.metrics.${m}.name`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {onPagesChange ? (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-2">
          <MultiSelect
            label={t('analytics.filters.page')}
            allLabel={t('analytics.filters.allPages')}
            emptyLabel={t('analytics.filters.noPages')}
            options={(channels.data ?? [])
              .filter((p) => p.status !== 'disconnected')
              .map((p) => ({ value: p.id, label: p.name }))}
            value={pages ?? []}
            onChange={onPagesChange}
          />
          <p className="max-w-md text-xs text-muted-foreground">
            {t('analytics.filters.pageNote')}
          </p>
        </div>
      ) : null}
      <ChartContainer config={config} className="mt-4 aspect-auto h-64 w-full">
        <AreaChart data={data} margin={{ left: 4, right: 4 }}>
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
            width={64}
            allowDecimals={false}
            tickFormatter={(v: number) =>
              new Intl.NumberFormat(i18n.language, {
                notation: 'compact',
                maximumFractionDigits: 1,
              }).format(v)
            }
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => formatDate(String(label))}
                formatter={(v) => formatNumber(Number(v))}
              />
            }
          />
          <Area
            type="linear"
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={2}
            fill="var(--color-value)"
            fillOpacity={0.12}
            isAnimationActive={false}
          />
        </AreaChart>
      </ChartContainer>
    </section>
  );
}
