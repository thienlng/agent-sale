import { type MetricDefinition, type MetricKey, type MetricResult } from '@agent-sales/contracts';
import { AlertCircle, Info, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

/** What the number means, from the same definition the server computes it by. */
function DefinitionHelp({
  metric,
  definition,
}: {
  metric: MetricKey;
  definition?: MetricDefinition | undefined;
}) {
  const { t } = useTranslation();
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"
          aria-label={`${t('analytics.definition.title')}: ${t(`analytics.metrics.${metric}.name`)}`}
        >
          <Info className="size-4" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-72 text-sm" align="start">
        <p className="font-medium">{t(`analytics.metrics.${metric}.name`)}</p>
        <p className="mt-1 text-muted-foreground">{t(`analytics.metrics.${metric}.help`)}</p>
        {definition ? (
          <ul className="mt-2 flex flex-col gap-1 text-xs text-muted-foreground">
            <li>{t(`analytics.definition.kind.${definition.kind}`)}</li>
            <li>{t(`analytics.definition.attribution.${definition.attribution}`)}</li>
            <li>
              {t('analytics.definition.origins', {
                list: definition.origins.allowed.map((o) => t(`analytics.origins.${o}`)).join(', '),
              })}
            </li>
            <li>{t('analytics.definition.version', { version: definition.version })}</li>
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export type CardState =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'unavailable' }
  | { kind: 'result'; result: MetricResult };

/**
 * One number. Loading, failed, locked and "no data source" each look different from a real 0, so a
 * problem is never mistaken for an empty result.
 */
export function MetricCard({
  metric,
  state,
  definition,
  onOpen,
}: {
  metric: MetricKey;
  state: CardState;
  definition?: MetricDefinition | undefined;
  /** Opens the rows behind the number; absent when there are none to show. */
  onOpen?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  const name = t(`analytics.metrics.${metric}.name`);
  const ok = state.kind === 'result' && state.result.state === 'ok' ? state.result : null;
  const body =
    state.kind === 'loading' ? (
      <Skeleton className="mt-3 h-9 w-24" />
    ) : state.kind === 'error' ? (
      <p className="mt-3 flex items-center gap-1.5 text-sm text-destructive">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        {t('analytics.states.errorTitle')}
      </p>
    ) : state.kind === 'unavailable' ? (
      <p className="mt-3 text-sm text-muted-foreground">{t('analytics.states.unavailable')}</p>
    ) : ok ? (
      <p
        data-metric-value
        className={cn(
          'mt-2 break-all font-semibold leading-tight tabular-nums',
          formatNumber(ok.value).length > 7 ? 'text-[clamp(1.125rem,10cqi,1.875rem)]' : 'text-3xl',
        )}
      >
        {formatNumber(ok.value)}
      </p>
    ) : (
      <p className="mt-3 flex items-center gap-1.5 text-sm text-muted-foreground">
        <Lock className="size-4 shrink-0" aria-hidden />
        {t('analytics.states.locked')}
      </p>
    );
  return (
    <div
      data-metric-card
      className={cn(
        '@container flex min-w-0 flex-col rounded-lg border p-4',
        onOpen && ok && 'transition-colors hover:bg-muted/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-sm font-medium text-muted-foreground">{name}</h3>
        <DefinitionHelp metric={metric} definition={definition} />
      </div>
      {onOpen && ok ? (
        <button
          type="button"
          className="mt-0 text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          onClick={onOpen}
          aria-label={t('analytics.drilldown.title', { metric: name })}
        >
          {body}
        </button>
      ) : (
        body
      )}
    </div>
  );
}
