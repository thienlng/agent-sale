import type { MetricKey } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useCan } from '@/lib/permissions';

import { useDefinitions, useStatistics } from '../api/analytics';
import {
  buildQueries,
  CONVERSATION_METRICS,
  daysAgo,
  resolveFilters,
  toSearch,
} from '../lib/filters';
import { type CardState, MetricCard } from './metric-card';

const PERIODS = ['7', '30'] as const;
type Period = (typeof PERIODS)[number];

/**
 * One bot's figures on its home. Facts carry the page, not the bot, so the bot is the pages assigned
 * to it: the same conversation query as the statistics page with its page filter, hence the same
 * numbers there. `pageIds` is undefined while the pages load.
 */
export function BotStatistics({
  botId,
  pageIds,
}: {
  botId: string;
  pageIds: readonly string[] | undefined;
}) {
  const { t } = useTranslation();
  const allowed = useCan('analytics.view');
  const [period, setPeriod] = useState<Period>('7');
  const filters = resolveFilters({
    from: daysAgo(Number(period) - 1),
    pages: [...(pageIds ?? [])],
  });
  const hasPages = Boolean(pageIds?.length);
  const stats = useStatistics(
    'bot',
    allowed && hasPages ? buildQueries(filters).conversations : null,
  );
  const definitions = useDefinitions();

  if (!allowed) return null;

  const stateOf = (m: MetricKey): CardState => {
    if (!pageIds || stats.isPlaceholderData) return { kind: 'loading' };
    const result = stats.data?.cards.find((c) => c.key === m);
    if (result) return { kind: 'result', result };
    return stats.isError ? { kind: 'error' } : { kind: 'loading' };
  };

  return (
    <section
      aria-labelledby="bot-statistics-title"
      className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-4"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 id="bot-statistics-title" className="text-lg font-semibold">
            {t('analytics.bot.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('analytics.bot.subtitle')}</p>
        </div>
        {hasPages ? (
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            value={period}
            onValueChange={(v) => v && setPeriod(v as Period)}
            aria-label={t('analytics.bot.period')}
          >
            {PERIODS.map((p) => (
              <ToggleGroupItem key={p} value={p}>
                {t('analytics.bot.days', { count: Number(p) })}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>
      {pageIds && !hasPages ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4">
          <p className="text-sm text-muted-foreground">{t('analytics.bot.noChannels')}</p>
          <Button asChild size="sm" variant="outline">
            <Link to="/app/bots/$botId/integrations" params={{ botId }}>
              {t('analytics.bot.connect')}
            </Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {CONVERSATION_METRICS.map((m) => (
              <MetricCard
                key={m}
                metric={m}
                state={stateOf(m)}
                definition={definitions.data?.definitions.find((d) => d.key === m)}
              />
            ))}
          </div>
          <Link
            to="/app/analytics"
            search={toSearch(filters)}
            className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('analytics.bot.openFull')}
          </Link>
        </>
      )}
    </section>
  );
}
