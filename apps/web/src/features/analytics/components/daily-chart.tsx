import type { AnalyticsResponse, MetricKey } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { Label } from '@/components/ui/label';
import { formatDate, formatNumber } from '@/lib/format';

/** One event metric per day of the range, zero-filled by the server (a day with nothing is a real 0). */
export function DailyChart({
  series,
  metrics,
}: {
  series: AnalyticsResponse['series'];
  metrics: readonly MetricKey[];
}) {
  const { t } = useTranslation();
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
      <ChartContainer config={config} className="mt-4 aspect-auto h-64 w-full">
        <BarChart data={data} margin={{ left: 4, right: 4 }}>
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
            width={40}
            allowDecimals={false}
            tickFormatter={(v: number) => formatNumber(v)}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => formatDate(String(label))}
                formatter={(v) => formatNumber(Number(v))}
              />
            }
          />
          <Bar dataKey="value" fill="var(--color-value)" radius={4} />
        </BarChart>
      </ChartContainer>
    </section>
  );
}
