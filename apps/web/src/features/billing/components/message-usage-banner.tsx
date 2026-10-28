import { useTranslation } from 'react-i18next';

import { formatDateTime } from '@/lib/format';

import { useMessageUsage } from '../api/use-message-usage';

/** From this share of the allowance on, staff are warned before bots start handing off. */
export const NEAR_LIMIT_RATIO = 0.8;

/**
 * Tells staff when the account's AI messages run low or out: once exhausted, bots hand every
 * customer to staff until the cycle renews (ADR-012 §5).
 */
export function MessageUsageBanner() {
  const { t } = useTranslation();
  const { data } = useMessageUsage();
  if (!data?.metered) return null;
  const values = { used: data.used, limit: data.limit, date: formatDateTime(data.cycleEnd) };
  if (data.exhausted)
    return (
      <div
        role="alert"
        className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
      >
        <p className="font-medium text-destructive">{t('billing.usage.exhaustedTitle')}</p>
        <p className="text-muted-foreground">{t('billing.usage.exhaustedBody', values)}</p>
      </div>
    );
  if (data.used < data.limit * NEAR_LIMIT_RATIO) return null;
  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
    >
      <p className="font-medium">{t('billing.usage.nearTitle')}</p>
      <p className="text-muted-foreground">{t('billing.usage.nearBody', values)}</p>
    </div>
  );
}
