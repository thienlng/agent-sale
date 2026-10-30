import type { SaasStage } from '@agent-sales/contracts';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDay, formatNumber, formatVnd } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { useSaasSummary, useTrialsEndingSoon } from '../api/saas';

/**
 * Revenue at a glance above the customer list: MRR, customers per subscription stage (a click
 * filters the list by the matching status) and trials ending in the next 7 days.
 * Needs contacts.view_all; renders nothing otherwise.
 */
export function SaasSummaryStrip(props: {
  onStage: (stage: SaasStage) => void;
  onOpenContact: (contactId: string) => void;
}) {
  if (!useCan('contacts.view_all')) return null;
  return <Strip {...props} />;
}

function Strip({
  onStage,
  onOpenContact,
}: {
  onStage: (stage: SaasStage) => void;
  onOpenContact: (contactId: string) => void;
}) {
  const { t } = useTranslation();
  const summary = useSaasSummary(true);
  const [showSoon, setShowSoon] = useState(false);
  const soon = useTrialsEndingSoon(showSoon);
  const s = summary.data;
  if (summary.isError)
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        {t('saas.loadError')}
        <Button size="sm" variant="outline" onClick={() => void summary.refetch()}>
          {t('saas.retry')}
        </Button>
      </div>
    );
  const stages: SaasStage[] = ['active', 'trial', 'past_due', 'canceled'];
  const cell = 'rounded-xl border bg-card px-4 py-3 text-left';
  return (
    <div className="space-y-2">
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6"
        aria-busy={summary.isPending}
      >
        <div className={cell}>
          <span className="block text-xs text-muted-foreground">{t('saas.summary.mrr')}</span>
          <span className="block mt-1 text-lg font-semibold tabular-nums">
            {s ? formatVnd(s.mrr) : '…'}
          </span>
        </div>
        {stages.map((stage) => (
          <div key={stage}>
            <button
              type="button"
              className={cn(
                cell,
                'w-full hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none',
              )}
              onClick={() => onStage(stage)}
            >
              <span className="block text-xs text-muted-foreground">
                {t(`saas.summary.${stage}`)}
              </span>
              <span className="block mt-1 text-lg font-semibold tabular-nums">
                {s ? formatNumber(s.stages[stage]) : '…'}
              </span>
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            aria-expanded={showSoon}
            className={cn(
              cell,
              'w-full hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none',
            )}
            onClick={() => setShowSoon((v) => !v)}
          >
            <span className="block text-xs text-muted-foreground">
              {t('saas.summary.trialsEndingSoon')}
            </span>
            <span className="block mt-1 text-lg font-semibold tabular-nums">
              {s ? formatNumber(s.trialsEndingSoon) : '…'}
            </span>
          </button>
        </div>
      </div>
      {showSoon ? (
        <ul className="divide-y rounded-xl border text-sm" aria-busy={soon.isPending}>
          {soon.data?.data.length === 0 ? (
            <li className="px-4 py-3 text-muted-foreground">{t('saas.noTrialsEndingSoon')}</li>
          ) : null}
          {soon.data?.data.map((sub) => (
            <li key={sub.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 px-4 py-2 text-left hover:bg-muted/50"
                onClick={() => onOpenContact(sub.contactId)}
              >
                <span className="truncate font-medium">{sub.contactName ?? t('saas.unnamed')}</span>
                <span className="text-muted-foreground tabular-nums">
                  {sub.planName} · {sub.trialEndsOn && formatDay(sub.trialEndsOn)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
