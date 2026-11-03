import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';

import { useContactRequests } from '../api/requests';
import { requestDetailsLine, requestKindLabel } from '../utils/request-labels';

/**
 * "Yêu cầu": the latest requests the bot recorded on a customer of an education or spa
 * business (kind, course or service, branch, day and time window, when it was recorded).
 * Staff confirm them by moving the customer's status, which sits next to this card.
 */
export function CustomerRequestsCard({
  contactId,
  industry,
}: {
  contactId: string;
  industry: string;
}) {
  const { t } = useTranslation();
  const query = useContactRequests(contactId);
  const requests = query.data?.data ?? [];
  return (
    <section className="space-y-3 rounded-xl border p-4" aria-labelledby={`requests-${contactId}`}>
      <h3 id={`requests-${contactId}`} className="font-semibold">
        {t('crm.requests.title')}
      </h3>
      {query.isPending ? (
        <p role="status" className="text-sm">
          {t('crm.requests.loading')}
        </p>
      ) : query.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm">
          {t('crm.requests.loadError')}
          <Button size="sm" variant="outline" onClick={() => void query.refetch()}>
            {t('crm.requests.retry')}
          </Button>
        </div>
      ) : requests.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('crm.requests.card.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {requests.map((r) => {
            const line = requestDetailsLine(r.details, r.dateLabel);
            return (
              <li key={r.id} className="rounded-lg border p-2 text-sm">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-medium">{requestKindLabel(t, r.kind, industry)}</span>
                  {r.update ? (
                    <Badge variant="outline">{t('crm.requests.card.updated')}</Badge>
                  ) : null}
                </div>
                {line ? <p className="mt-0.5 break-words">{line}</p> : null}
                <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                  {t('crm.requests.card.recordedAt', { time: formatDateTime(r.recordedAt) })}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
