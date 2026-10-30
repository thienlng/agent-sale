import { type MetricKey, type MetricResult } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { BusinessAvatar } from '@/components/business-avatar';
import { Button } from '@/components/ui/button';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useIsMutating } from '@tanstack/react-query';
import { useBusinessSwitch } from '@/hooks/use-business-switch';
import { useSession } from '@/lib/session';

import { type PortfolioRow, usePortfolio } from '../api/portfolio';
import { resolveFilters, rangeProblem, type FiltersSearch } from '../lib/filters';
import { DateRangeToolbar } from './portfolio-toolbar';
import { DailyChart } from './daily-chart';
import { MetricCard } from './metric-card';

const METRICS: readonly MetricKey[] = [
  'conversations.opened',
  'customers.new',
  'phones.captured',
  'messages.inbound',
];
function result(row: PortfolioRow, metric: MetricKey): MetricResult | undefined {
  return [...(row.people?.cards ?? []), ...(row.conversations?.cards ?? [])].find(
    (card) => card.key === metric,
  );
}

export function PortfolioPage({
  search,
  onSearch,
  lost = false,
}: {
  search: FiltersSearch;
  onSearch: (next: FiltersSearch) => void;
  /** Sent here after losing access to the business that was open (T-079). */
  lost?: boolean;
}) {
  const { t } = useTranslation();
  const session = useSession();
  const { busy, choose } = useBusinessSwitch();
  const mutations = useIsMutating();
  const filters = resolveFilters(search);
  const problem = rangeProblem(filters);
  const query = usePortfolio(filters.from, filters.to);
  const rows = query.data ?? [];
  const zones = new Set(
    rows
      .flatMap((row) => [row.people?.meta.timezone, row.conversations?.meta.timezone])
      .filter(Boolean),
  );
  const complete =
    rows.length > 0 &&
    zones.size === 1 &&
    rows.every(
      (row) =>
        row.state === 'ready' && METRICS.every((metric) => result(row, metric)?.state === 'ok'),
    );
  const seriesByDate = new Map<string, number>();
  if (complete)
    for (const row of rows)
      for (const day of row.conversations?.series ?? [])
        seriesByDate.set(
          day.date,
          (seriesByDate.get(day.date) ?? 0) + (day.values['conversations.opened'] ?? 0),
        );
  const metadata = rows
    .flatMap((row) => [row.people?.meta, row.conversations?.meta])
    .filter((meta) => meta !== undefined);
  const oldest = metadata.map((meta) => meta.generatedAt).sort()[0];
  const lag = Math.max(0, ...metadata.map((meta) => meta.lagSeconds));
  const own = rows.some((row) => row.people?.meta.scope === 'own');
  return (
    <section className="flex min-w-0 flex-col gap-5">
      {lost ? (
        <p
          role="alert"
          className="rounded-lg bg-destructive-soft px-3 py-2.5 text-sm text-destructive"
        >
          {t('business.lost')}
        </p>
      ) : null}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('analytics.overview.title')}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{t('analytics.overview.subtitle')}</p>
      </div>
      <DateRangeToolbar value={filters} onChange={onSearch} />
      {problem ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`analytics.filters.${problem}`)}
        </p>
      ) : null}
      <section
        className="grid grid-cols-2 gap-3 xl:grid-cols-4"
        aria-label={t('analytics.overview.primary')}
      >
        {METRICS.map((metric) => (
          <MetricCard
            key={metric}
            metric={metric}
            state={
              query.isPending
                ? { kind: 'loading' }
                : complete
                  ? {
                      kind: 'result',
                      result: {
                        key: metric,
                        state: 'ok',
                        value: rows.reduce((sum, row) => {
                          const card = result(row, metric);
                          return sum + (card?.state === 'ok' ? card.value : 0);
                        }, 0),
                      },
                    }
                  : { kind: 'error' }
            }
          />
        ))}
      </section>
      {query.isError || (!query.isPending && rows.length > 0 && !complete) ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
        >
          <p className="text-sm">{t('analytics.overview.incomplete')}</p>
          <Button variant="outline" onClick={() => void query.refetch()}>
            {t('analytics.overview.retry')}
          </Button>
        </div>
      ) : null}
      {own ? (
        <p className="text-sm text-muted-foreground">{t('analytics.overview.scopeOwn')}</p>
      ) : null}
      {complete ? (
        <DailyChart
          metrics={['conversations.opened']}
          series={[...seriesByDate]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, value]) => ({ date, values: { 'conversations.opened': value } }))}
        />
      ) : null}
      <section className="rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-semibold">{t('analytics.overview.businesses')}</h2>
          <Button asChild variant="outline" size="sm">
            <Link to="/app/businesses/new">{t('nav.newBusiness')}</Link>
          </Button>
        </div>
        {!session?.memberships.length ? (
          <p className="mt-3 text-sm text-muted-foreground">
            {t('analytics.overview.noBusinesses')}
          </p>
        ) : null}
        <div className="mt-2 divide-y">
          {session?.memberships.map((business) => {
            const row = rows.find((r) => r.business.workspaceId === business.workspaceId);
            const conversations = row && result(row, 'conversations.opened');
            return (
              <div
                key={business.workspaceId}
                className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4"
              >
                <BusinessAvatar
                  workspaceId={business.workspaceId}
                  logoVersion={business.logoVersion}
                  icon={business.icon}
                  className="size-10"
                />
                <div className="min-w-0 flex-1">
                  <p className="break-words font-medium">{business.workspaceName}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {query.isPending
                      ? t('analytics.overview.loading')
                      : row?.state === 'forbidden'
                        ? t('analytics.overview.noPermission')
                        : row?.state !== 'ready'
                          ? t('analytics.states.errorTitle')
                          : conversations?.state === 'ok'
                            ? `${t('analytics.metrics.conversations.opened.name')}: ${formatNumber(conversations.value)}`
                            : t('analytics.states.locked')}
                    {row?.people?.meta.scope === 'own'
                      ? ` · ${t('analytics.overview.scopeOwn')}`
                      : ''}
                  </p>
                </div>
                <Button
                  variant="outline"
                  disabled={busy || mutations > 0}
                  onClick={() => void choose(business.workspaceId)}
                >
                  {t('analytics.overview.open')}
                </Button>
              </div>
            );
          })}
        </div>
      </section>
      {oldest ? (
        <footer className="space-y-1 text-xs text-muted-foreground">
          <p>
            {t('analytics.freshness.updated', { time: formatDateTime(oldest) })} ·{' '}
            {t('analytics.freshness.timezone', { tz: [...zones].join(', ') })}
          </p>
          {lag > 30 ? <p role="status">{t('analytics.freshness.lag', { seconds: lag })}</p> : null}
        </footer>
      ) : null}
      <p className="text-xs text-muted-foreground">{t('analytics.overview.recordsNote')}</p>
      <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
        {t('analytics.overview.shopPending')}
      </p>
    </section>
  );
}
