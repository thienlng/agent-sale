import { CircleCheck, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/lib/format';

import { useDataDeletionStatus } from '../api/data-deletion';

/**
 * The page Meta links a person to after they asked for their data to be deleted (docs/07 "Data
 * deletion callback"): what was asked, whether it is done, and what that means.
 */
export function DataDeletionStatus({ code }: { code: string | undefined }) {
  const { t } = useTranslation();
  const status = useDataDeletionStatus(code);
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold text-balance">{t('dataDeletion.title')}</h1>
      <p className="text-sm text-muted-foreground">{t('dataDeletion.intro')}</p>
      {!code || status.isError ? (
        <p role="alert" className="rounded-lg border p-4 text-sm">
          {t('dataDeletion.notFound')}
        </p>
      ) : status.isPending ? (
        <Skeleton className="h-24" />
      ) : (
        <section className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            {status.data.status === 'completed' ? (
              <CircleCheck className="size-4 text-success" aria-hidden />
            ) : (
              <Clock className="size-4 text-muted-foreground" aria-hidden />
            )}
            {t(`dataDeletion.status.${status.data.status}`)}
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <dt>{t('dataDeletion.code')}</dt>
            <dd className="font-mono text-foreground">{status.data.confirmationCode}</dd>
            <dt>{t('dataDeletion.requestedAt')}</dt>
            <dd className="tabular-nums">{formatDateTime(status.data.requestedAt)}</dd>
            {status.data.completedAt ? (
              <>
                <dt>{t('dataDeletion.completedAt')}</dt>
                <dd className="tabular-nums">{formatDateTime(status.data.completedAt)}</dd>
              </>
            ) : null}
          </dl>
          <p className="text-muted-foreground">
            {status.data.status === 'completed'
              ? t('dataDeletion.completedBody', { count: status.data.connectionsRemoved })
              : t('dataDeletion.pendingBody')}
          </p>
        </section>
      )}
      <p className="text-xs text-muted-foreground">{t('dataDeletion.scope')}</p>
    </div>
  );
}
