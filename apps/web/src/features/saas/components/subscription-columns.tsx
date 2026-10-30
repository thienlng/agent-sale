import type { SaasStage } from '@agent-sales/contracts';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDay, formatVnd } from '@/lib/format';

import { useSubscriptionsOf } from '../api/saas';

/** Customer status (crm built-in key) each subscription stage puts the customer in (ADR-014). */
export const STAGE_STATUS_KEY: Record<SaasStage, string> = {
  trial: 'trial',
  active: 'paying',
  past_due: 'past_due',
  canceled: 'churned',
};

export interface SubscriptionColumn {
  id: string;
  /** Translated header. */
  header: string;
  className?: string;
  cell: (contactId: string) => ReactNode;
}

/**
 * Plan, MRR and next date of the customers on the current list page, as extra list columns.
 * Empty without `enabled` (revenue figures need contacts.view_all).
 */
export function useSubscriptionColumns(
  contactIds: readonly string[],
  enabled: boolean,
): SubscriptionColumn[] {
  const { t } = useTranslation();
  const subs = useSubscriptionsOf(contactIds, enabled).data;
  if (!enabled) return [];
  const dash = <span className="text-muted-foreground">—</span>;
  return [
    {
      id: 'saas.plan',
      header: t('saas.col.plan'),
      cell: (id) => subs?.get(id)?.planName ?? dash,
    },
    {
      id: 'saas.mrr',
      header: t('saas.col.mrr'),
      className: 'text-right tabular-nums',
      cell: (id) => {
        const sub = subs?.get(id);
        return sub ? formatVnd(sub.mrr) : dash;
      },
    },
    {
      id: 'saas.next',
      header: t('saas.col.next'),
      className: 'tabular-nums',
      cell: (id) => {
        const sub = subs?.get(id);
        const next = sub?.stage === 'trial' ? sub.trialEndsOn : sub?.renewsOn;
        return sub && next ? (
          <span title={t(sub.stage === 'trial' ? 'saas.sub.trialEndsOn' : 'saas.sub.renewsOn')}>
            {formatDay(next)}
          </span>
        ) : (
          dash
        );
      },
    },
  ];
}
