import type { DrilldownDimension, DrilldownRequest, MetricKey } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiClientError } from '@/lib/api-client';
import { formatDateTime, formatNumber } from '@/lib/format';

import { useDrilldown } from '../api/analytics';
import type { Names } from './breakdowns';

export interface DrillTarget {
  metric: MetricKey;
  dimension: DrilldownDimension;
  /** What the dimension is, for the title (a tag, a salesperson, …). */
  label: string | null;
  request: DrilldownRequest;
}

/** The rows behind a number, with the same filters and data as the card that opened it. */
export function DrilldownSheet({
  target,
  names,
  onClose,
}: {
  target: DrillTarget | null;
  names: Names;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const q = useDrilldown(target?.request ?? null);
  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = q.data?.pages[0]?.total;
  const name = target ? t(`analytics.metrics.${target.metric}.name`) : '';
  const forConversation =
    target?.metric.startsWith('messages.') || target?.metric.startsWith('conversations.');
  return (
    <Sheet open={Boolean(target)} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-2xl">
        <SheetHeader className="border-b">
          <SheetTitle>{t('analytics.drilldown.title', { metric: name })}</SheetTitle>
          <SheetDescription>
            {target?.label ? (
              <Badge variant="secondary" className="mr-2 max-w-full truncate">
                {target.label}
              </Badge>
            ) : null}
            {total !== undefined ? t('analytics.drilldown.total', { count: total }) : null}
          </SheetDescription>
        </SheetHeader>
        <div className="p-4">
          {q.isPending ? (
            <div className="flex flex-col gap-2" aria-label={t('analytics.states.loading')}>
              {[0, 1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          ) : q.isError ? (
            <div role="alert" className="flex flex-col items-start gap-3">
              <p className="text-sm text-destructive">
                {q.error instanceof ApiClientError && q.error.code === 'FORBIDDEN'
                  ? t('analytics.states.forbidden')
                  : t('analytics.states.errorBody')}
              </p>
              <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
                {t('analytics.states.retry')}
              </Button>
            </div>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('analytics.drilldown.empty')}</p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('analytics.drilldown.time')}</TableHead>
                    <TableHead>
                      {forConversation
                        ? t('analytics.drilldown.page')
                        : t('analytics.drilldown.customer')}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={`${r.at}-${r.contactId ?? r.conversationId ?? i}-${i}`}>
                      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatDateTime(r.at)}
                      </TableCell>
                      <TableCell className="max-w-64 truncate">
                        {r.contactId ? (
                          <Link
                            to="/app/contacts"
                            search={{ contact: r.contactId }}
                            className="font-medium text-primary hover:underline"
                          >
                            {r.contactName || t('analytics.drilldown.noName')}
                          </Link>
                        ) : (
                          names.page(r.channelId)
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  {formatNumber(rows.length)} / {formatNumber(total ?? rows.length)}
                </span>
                {q.hasNextPage ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={q.isFetchingNextPage}
                    onClick={() => void q.fetchNextPage()}
                  >
                    {t('analytics.drilldown.more')}
                  </Button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
