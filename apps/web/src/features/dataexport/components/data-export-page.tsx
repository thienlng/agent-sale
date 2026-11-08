import type { DataExportDto, DataExportStatus } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import { Download, FileArchive, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatDay, formatNumber, isoDate } from '@/lib/format';
import { useCan } from '@/lib/permissions';

import {
  isInProgress,
  useDataExportLink,
  useDataExports,
  useStartDataExport,
} from '../api/dataexport';

const STATUS_VARIANT: Record<
  DataExportStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  queued: 'outline',
  running: 'outline',
  ready: 'default',
  failed: 'destructive',
  expired: 'secondary',
};

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** 1536 → "1,5 KB" (binary steps, one decimal above bytes). */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${formatNumber(value, unit === 0 ? 0 : 1)} ${UNITS[unit]}`;
}

/** A friendly sentence for the export endpoints' refusals. */
function exportError(t: TFunction, error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'RATE_LIMITED' || error.status === 429) {
      return t('wsettings.data.errors.limit');
    }
    if (error.code === 'UNAVAILABLE' || error.status === 503) {
      return t('wsettings.data.errors.unavailable');
    }
    if (error.code === 'CONFLICT') return t('wsettings.data.errors.running');
  }
  return errorMessage(t, error);
}

/** Lets the browser stream the ZIP itself (the one-time link needs no auth header). */
function navigateTo(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
}

/** Whole-workspace data export: start one, follow its progress, download the ZIP (owner/admin). */
export function DataExportPage() {
  const { t } = useTranslation();
  const canExport = useCan('data.export');
  const exports = useDataExports({ enabled: canExport });
  const start = useStartDataExport();
  const [includeMedia, setIncludeMedia] = useState(false);

  if (!canExport) {
    return <p className="max-w-3xl text-sm text-muted-foreground">{t('wsettings.data.denied')}</p>;
  }

  const list = exports.data;
  const running = list?.data.some(isInProgress) ?? false;
  const remaining = list ? Math.max(0, list.dailyLimit - list.usedToday) : 0;
  const blocked = !list || running || remaining === 0;

  const onStart = () =>
    start.mutate(
      { includeMedia },
      {
        onSuccess: () => toast.success(t('wsettings.data.started')),
        onError: (e) => toast.error(exportError(t, e)),
      },
    );

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <section aria-labelledby="data-export-title" className="flex flex-col gap-3">
        <div>
          <h2 id="data-export-title" className="font-semibold">
            {t('wsettings.data.title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('wsettings.data.hint')}</p>
        </div>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
          <li>{t('wsettings.data.points.csv')}</li>
          <li>{t('wsettings.data.points.secrets')}</li>
          <li>{t('wsettings.data.points.retention')}</li>
        </ul>
        <div className="flex flex-col gap-4 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={includeMedia}
              onCheckedChange={(c) => setIncludeMedia(c === true)}
            />
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{t('wsettings.data.includeMedia')}</span>
              <span className="text-xs text-muted-foreground">
                {t('wsettings.data.includeMediaHint')}
              </span>
            </span>
          </label>
          <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
            <Button disabled={blocked || start.isPending} onClick={onStart}>
              {start.isPending ? (
                <Loader2 aria-hidden className="animate-spin" />
              ) : (
                <FileArchive aria-hidden />
              )}
              {t('wsettings.data.start')}
            </Button>
            {list ? (
              <p className="text-xs text-muted-foreground" aria-live="polite">
                {running
                  ? t('wsettings.data.inProgress')
                  : remaining === 0
                    ? t('wsettings.data.limitReached', { limit: list.dailyLimit })
                    : t('wsettings.data.remaining', { count: remaining })}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="data-export-recent" className="flex flex-col gap-3">
        <h3 id="data-export-recent" className="font-semibold">
          {t('wsettings.data.recent')}
        </h3>
        {exports.isPending ? (
          <Skeleton className="h-24" />
        ) : exports.isError ? (
          <p className="text-sm text-destructive">{t('wsettings.data.loadError')}</p>
        ) : exports.data.data.length ? (
          <ul className="divide-y rounded-xl border">
            {exports.data.data.map((item) => (
              <ExportRow key={item.id} item={item} onGone={() => void exports.refetch()} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
            {t('wsettings.data.empty')}
          </p>
        )}
      </section>
    </div>
  );
}

function ExportRow({ item, onGone }: { item: DataExportDto; onGone: () => void }) {
  const { t } = useTranslation();
  const link = useDataExportLink();
  const ready = item.status === 'ready';

  const onDownload = () =>
    link.mutate(item.id, {
      onSuccess: (res) => navigateTo(res.url),
      onError: (e) => {
        const gone =
          e instanceof ApiClientError && (e.code === 'CONFLICT' || e.code === 'NOT_FOUND');
        toast.error(gone ? t('wsettings.data.errors.gone') : errorMessage(t, e));
        if (gone) onGone();
      },
    });

  const details = [
    item.requestedByName,
    item.includeMedia ? t('wsettings.data.withMedia') : t('wsettings.data.dataOnly'),
    ready && item.sizeBytes !== null ? formatBytes(item.sizeBytes) : null,
    ready && item.expiresAt
      ? t('wsettings.data.expires', { date: formatDay(isoDate(new Date(item.expiresAt))) })
      : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <time dateTime={item.createdAt} className="tabular-nums">
            {formatDateTime(item.createdAt)}
          </time>
          <Badge variant={STATUS_VARIANT[item.status]}>
            {isInProgress(item) ? <Loader2 aria-hidden className="animate-spin" /> : null}
            {t(`wsettings.data.status.${item.status}`)}
          </Badge>
        </p>
        <p className="text-xs text-muted-foreground">{details.join(' · ')}</p>
        {item.status === 'failed' ? (
          <p className="text-xs text-destructive">{t('wsettings.data.failedHint')}</p>
        ) : null}
      </div>
      {ready ? (
        <Button variant="outline" size="sm" disabled={link.isPending} onClick={onDownload}>
          {link.isPending ? (
            <Loader2 aria-hidden className="animate-spin" />
          ) : (
            <Download aria-hidden />
          )}
          {t('wsettings.data.download')}
        </Button>
      ) : null}
    </li>
  );
}
