import type { SyncLogEntry } from '@agent-sales/contracts';
import { CircleAlert, Info, type LucideIcon, TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime, formatNumber, formatRelativeTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const LEVEL: Record<SyncLogEntry['level'], { icon: LucideIcon; className: string }> = {
  info: { icon: Info, className: 'text-muted-foreground' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  error: { icon: CircleAlert, className: 'text-destructive' },
};

/** One log line in words; an unknown code reads as a generic event instead of failing. */
export function useLogMessage() {
  const { t, i18n } = useTranslation('integration');
  return (entry: Pick<SyncLogEntry, 'code' | 'params'>) => {
    const key = `log.${entry.code}`;
    if (!/^[a-z_]+$/.test(entry.code) || !i18n.exists(key, { ns: 'integration' }))
      return t('log.unknown');
    const params = Object.fromEntries(
      Object.entries(entry.params).map(([k, v]) => [
        k,
        typeof v === 'number' ? formatNumber(v) : v,
      ]),
    );
    return t(key, params);
  };
}

/** Recent sync activity: codes and counts only, never provider payloads. */
export function SyncLogList({
  entries,
  loading,
  failed,
}: {
  entries: readonly SyncLogEntry[] | undefined;
  loading: boolean;
  failed: boolean;
}) {
  const { t } = useTranslation('integration');
  const message = useLogMessage();
  if (loading)
    return (
      <div className="flex flex-col gap-2" aria-busy>
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    );
  if (failed)
    return <p className="text-sm text-muted-foreground">{t('connection.activityError')}</p>;
  if (!entries?.length)
    return <p className="text-sm text-muted-foreground">{t('connection.activityEmpty')}</p>;
  return (
    <ul className="flex flex-col divide-y">
      {entries.map((entry) => {
        const { icon: Icon, className } = LEVEL[entry.level];
        return (
          <li key={entry.id} className="flex items-start gap-3 py-2.5">
            <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', className)} />
            <span className="sr-only">{t(`log.level.${entry.level}`)}: </span>
            <span className="min-w-0 flex-1 text-sm break-words">{message(entry)}</span>
            <time
              dateTime={entry.at}
              title={formatDateTime(entry.at)}
              className="shrink-0 text-xs text-muted-foreground tabular-nums"
            >
              {formatRelativeTime(entry.at)}
            </time>
          </li>
        );
      })}
    </ul>
  );
}
