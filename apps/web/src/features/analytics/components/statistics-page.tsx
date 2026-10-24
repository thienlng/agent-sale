import type {
  AnalyticsResponse,
  DrilldownDimension,
  MetricDefinition,
  MetricKey,
} from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useCan } from '@/lib/permissions';

import {
  useAssignees,
  useDefinitions,
  usePages,
  useStatistics,
  useStatusNames,
  useTagNames,
} from '../api/analytics';
import {
  buildQueries,
  type FiltersSearch,
  groupOf,
  rangeProblem,
  resolveFilters,
  toSearch,
} from '../lib/filters';
import { Breakdowns, type Names } from './breakdowns';
import { DailyChart } from './daily-chart';
import { DrilldownSheet, type DrillTarget } from './drilldown-sheet';
import { FilterBar } from './filter-bar';
import { type CardState, MetricCard } from './metric-card';

const SECTIONS: ReadonlyArray<{ key: string; metrics: readonly MetricKey[] }> = [
  { key: 'activity', metrics: ['customers.new', 'phones.captured'] },
  { key: 'tags', metrics: ['tags.assigned', 'tags.removed', 'tags.net', 'tags.current'] },
  { key: 'statuses', metrics: ['statuses.changed', 'statuses.current'] },
  {
    key: 'conversations',
    metrics: ['conversations.opened', 'messages.inbound', 'messages.outbound', 'comments.received'],
  },
];
/** Derived numbers are computed from others and have no rows of their own. */
const NOT_DRILLABLE: readonly MetricKey[] = ['tags.net'];
const EVENT_METRICS: readonly MetricKey[] = [
  'customers.new',
  'phones.captured',
  'tags.assigned',
  'tags.removed',
  'tags.net',
  'statuses.changed',
  'conversations.opened',
  'messages.inbound',
  'messages.outbound',
];

export function StatisticsPage({
  search,
  onSearch,
}: {
  search: FiltersSearch;
  onSearch: (next: FiltersSearch) => void;
}) {
  const { t } = useTranslation();
  const allowed = useCan('analytics.view');
  const canPickSales = useCan('contacts.view_all');
  const filters = resolveFilters(search);
  const problem = rangeProblem(filters);
  // Query keys hash by value, so rebuilding the (small) query objects each render costs nothing.
  const queries = buildQueries(filters);

  const people = useStatistics('people', problem || !allowed ? null : queries.people);
  const tagStatus = useStatistics('tagStatus', problem || !allowed ? null : queries.tagStatus);
  const conversations = useStatistics(
    'conversations',
    problem || !allowed ? null : queries.conversations,
  );
  const definitions = useDefinitions();
  const assignees = useAssignees();
  const pages = usePages();
  const tags = useTagNames();
  const statuses = useStatusNames();
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const byGroup = { people, tagStatus, conversations } as const;
  const defOf = (m: MetricKey): MetricDefinition | undefined =>
    definitions.data?.definitions.find((d) => d.key === m);

  const names: Names = {
    tag: (id) => tags.data?.find((x) => x.id === id)?.name ?? t('analytics.breakdowns.unknownTag'),
    status: (id) =>
      id === null
        ? t('analytics.breakdowns.noStatus')
        : (statuses.data?.find((x) => x.id === id)?.name ??
          t('analytics.breakdowns.unknownStatus')),
    member: (id) =>
      id === null
        ? t('analytics.breakdowns.unassigned')
        : (assignees.data?.find((x) => x.userId === id)?.name ??
          t('analytics.breakdowns.unknownMember')),
    page: (id) =>
      id === null
        ? t('analytics.breakdowns.unknownPage')
        : (pages.data?.find((x) => x.id === id)?.name ?? t('analytics.breakdowns.unknownPage')),
  };

  if (!allowed) {
    return (
      <section className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t('analytics.title')}</h1>
        <p className="text-muted-foreground">{t('analytics.states.forbidden')}</p>
      </section>
    );
  }

  const stateOf = (m: MetricKey): CardState => {
    if (defOf(m)?.availability === 'pending_source' || m === 'comments.received') {
      return { kind: 'unavailable' };
    }
    const q = byGroup[groupOf(m)];
    const result = q.data?.cards.find((c) => c.key === m);
    if (result) return { kind: 'result', result };
    return q.isError ? { kind: 'error' } : { kind: 'loading' };
  };

  const open = (metric: MetricKey, dimension: DrilldownDimension, label: string | null) => {
    const group = groupOf(metric);
    const base =
      group === 'people'
        ? queries.people
        : group === 'tagStatus'
          ? queries.tagStatus
          : queries.conversations;
    const answered = byGroup[group].data;
    setDrill({
      metric,
      dimension,
      label,
      request: {
        // Same filters and the same data (watermark) as the number that was clicked.
        query: {
          ...base,
          metrics: [metric],
          ...(answered ? { watermark: answered.meta.watermarkId } : {}),
        },
        metric,
        dimension,
        limit: 50,
      },
    });
  };

  const answers: AnalyticsResponse[] = [people.data, tagStatus.data, conversations.data].filter(
    (a): a is AnalyticsResponse => Boolean(a),
  );
  const failed = [people, tagStatus, conversations].some((q) => q.isError && !q.data);
  const forbidden = [people, tagStatus, conversations].some(
    (q) => q.error instanceof ApiClientError && q.error.code === 'FORBIDDEN',
  );
  const meta = people.data?.meta ?? tagStatus.data?.meta ?? conversations.data?.meta;
  const days = people.data?.series ?? tagStatus.data?.series ?? conversations.data?.series ?? [];
  const merged = days.map((d, i) => ({
    date: d.date,
    values: Object.assign({}, ...answers.map((a) => a.series[i]?.values ?? {})) as Record<
      string,
      number
    >,
  }));
  const chartMetrics = EVENT_METRICS.filter((m) =>
    answers.some((a) => a.series[0]?.values[m] !== undefined),
  );
  const onlyChannel = filters.origins.length === 1 && filters.origins[0] === 'channel';
  const noChannelCustomers =
    onlyChannel &&
    people.data?.cards.some((c) => c.key === 'customers.new' && c.state === 'ok' && c.value === 0);
  const lag = Math.max(0, ...answers.map((a) => a.meta.lagSeconds));

  return (
    <section className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('analytics.title')}</h1>
        <p className="mt-1.5 max-w-3xl text-muted-foreground">{t('analytics.subtitle')}</p>
      </div>

      <FilterBar
        value={filters}
        onChange={(next) => onSearch(toSearch(next))}
        canPickSales={canPickSales}
      />

      {failed ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
        >
          <div>
            <p className="font-medium">
              {forbidden ? t('analytics.states.forbidden') : t('analytics.states.errorTitle')}
            </p>
            {forbidden ? null : (
              <p className="text-sm text-muted-foreground">{t('analytics.states.errorBody')}</p>
            )}
          </div>
          {forbidden ? null : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void Promise.all([people, tagStatus, conversations].map((q) => q.refetch()))
              }
            >
              {t('analytics.states.retry')}
            </Button>
          )}
        </div>
      ) : null}
      {noChannelCustomers ? (
        <p className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
          {t('analytics.states.noChannelCustomers')}
        </p>
      ) : null}

      {SECTIONS.map((s) => (
        <section
          key={s.key}
          className="flex flex-col gap-3"
          aria-label={t(`analytics.groups.${s.key}`)}
        >
          <h2 className="text-lg font-semibold">{t(`analytics.groups.${s.key}`)}</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {s.metrics.map((m) => (
              <MetricCard
                key={m}
                metric={m}
                state={stateOf(m)}
                definition={defOf(m)}
                onOpen={NOT_DRILLABLE.includes(m) ? undefined : () => open(m, {}, null)}
              />
            ))}
          </div>
        </section>
      ))}

      {chartMetrics.length ? <DailyChart series={merged} metrics={chartMetrics} /> : null}

      <Breakdowns
        tagStatus={tagStatus.data}
        people={people.data}
        conversations={conversations.data}
        names={names}
        onOpen={open}
      />

      {meta ? (
        <footer className="flex flex-col gap-1 text-sm text-muted-foreground">
          <p>
            {t('analytics.freshness.updated', { time: formatDateTime(meta.generatedAt) })} ·{' '}
            {t('analytics.freshness.timezone', { tz: meta.timezone })}
          </p>
          {lag > 30 ? <p role="status">{t('analytics.freshness.lag', { seconds: lag })}</p> : null}
          {meta.scope === 'own' ? <p>{t('analytics.freshness.scopeOwn')}</p> : null}
        </footer>
      ) : null}

      <DrilldownSheet target={drill} names={names} onClose={() => setDrill(null)} />
    </section>
  );
}
