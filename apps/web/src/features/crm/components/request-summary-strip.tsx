import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { cn } from '@/lib/utils';

import { useRequestSummary } from '../api/requests';
import { requestDetailsLine, requestKindLabel } from '../utils/request-labels';

/**
 * Requests at a glance above the customer list of an education or spa business: customers per
 * status (a click filters the list by that status), requests of the last 7 days and the open
 * ones (a click opens the customer). Needs contacts.view_all; renders nothing otherwise.
 */
export function RequestSummaryStrip(props: {
  industry: string;
  onStatus: (statusId: string) => void;
  onOpenContact: (contactId: string) => void;
}) {
  if (!useCan('contacts.view_all')) return null;
  return <Strip {...props} />;
}

const CELL = 'rounded-xl border bg-card px-4 py-3 text-left';
const CLICKABLE =
  'w-full hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-offset-3 focus-visible:ring-offset-background focus-visible:ring-ring focus-visible:outline-none';

function Strip({
  industry,
  onStatus,
  onOpenContact,
}: {
  industry: string;
  onStatus: (statusId: string) => void;
  onOpenContact: (contactId: string) => void;
}) {
  const { t } = useTranslation();
  const summary = useRequestSummary(true);
  const [showOpen, setShowOpen] = useState(false);
  const s = summary.data;
  if (summary.isError)
    return (
      <div role="alert" className="flex items-center gap-3 text-sm">
        {t('crm.requests.loadError')}
        <Button size="sm" variant="outline" onClick={() => void summary.refetch()}>
          {t('crm.requests.retry')}
        </Button>
      </div>
    );
  return (
    <section className="space-y-2" aria-label={t('crm.requests.strip.label')}>
      <div
        className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6"
        aria-busy={summary.isPending}
      >
        <div className={CELL}>
          <span className="block text-xs text-muted-foreground">
            {t('crm.requests.strip.recorded7d')}
          </span>
          <span className="mt-1 block text-lg font-semibold tabular-nums">
            {s ? formatNumber(s.recorded7d) : '…'}
          </span>
        </div>
        <div>
          <button
            type="button"
            aria-expanded={showOpen}
            className={cn(CELL, CLICKABLE)}
            onClick={() => setShowOpen((v) => !v)}
          >
            <span className="block text-xs text-muted-foreground">
              {t('crm.requests.strip.open')}
            </span>
            <span className="mt-1 block text-lg font-semibold tabular-nums">
              {s ? formatNumber(s.open.length) : '…'}
            </span>
          </button>
        </div>
        {s?.statuses.map((status) => (
          <div key={status.statusId}>
            <button
              type="button"
              title={t('crm.requests.strip.statusHint', { name: status.name })}
              className={cn(CELL, CLICKABLE)}
              onClick={() => onStatus(status.statusId)}
            >
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: status.color }}
                  aria-hidden
                />
                <span className="truncate">{status.name}</span>
              </span>
              <span className="mt-1 block text-lg font-semibold tabular-nums">
                {formatNumber(status.count)}
              </span>
            </button>
          </div>
        ))}
      </div>
      {showOpen && s ? (
        <ul className="divide-y rounded-xl border text-sm">
          {s.open.length === 0 ? (
            <li className="px-4 py-3 text-muted-foreground">{t('crm.requests.strip.noOpen')}</li>
          ) : null}
          {s.open.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 py-2 text-left hover:bg-muted/50"
                onClick={() => onOpenContact(r.contactId)}
              >
                <span className="min-w-0 truncate font-medium">
                  {r.contactName ?? t('crm.requests.unnamed')}
                </span>
                <span className="min-w-0 truncate text-muted-foreground">
                  {[
                    requestKindLabel(t, r.kind, industry),
                    requestDetailsLine(r.details, r.dateLabel),
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDateTime(r.recordedAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
