import {
  WebhookDeliveryStatus,
  type WebhookDeliveryDto,
  type WebhookEndpointDto,
} from '@agent-sales/contracts';
import { RotateCw } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';

import { useResendDelivery, useWebhookDeliveries } from '../api/developer';

const ALL = '__all';
const STATUS_VARIANT = {
  pending: 'outline',
  succeeded: 'secondary',
  failed: 'destructive',
} as const;

function DeliveryRow({ delivery }: { delivery: WebhookDeliveryDto }) {
  const { t } = useTranslation('developer');
  const { t: tc } = useTranslation();
  const resend = useResendDelivery();
  const details = [
    t('deliveries.attempts', { count: delivery.attempts }),
    delivery.lastStatusCode === null
      ? null
      : t('deliveries.httpStatus', { code: delivery.lastStatusCode }),
    delivery.status === 'pending' && delivery.nextAttemptAt
      ? t('deliveries.nextAttempt', { when: formatDateTime(delivery.nextAttemptAt) })
      : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          <Badge variant={STATUS_VARIANT[delivery.status]}>
            {t(`deliveries.status.${delivery.status}`)}
          </Badge>
          {t(`events.${delivery.eventType}`, { defaultValue: delivery.eventType })}
        </p>
        <time dateTime={delivery.createdAt} className="text-xs text-muted-foreground tabular-nums">
          {formatDateTime(delivery.createdAt)}
        </time>
      </div>
      <p className="text-xs text-muted-foreground">{details.join(' · ')}</p>
      {delivery.lastError ? (
        <p className="text-xs break-words text-destructive">{delivery.lastError}</p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <details className="min-w-0 flex-1 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {t('deliveries.payload')} · <code className="font-mono">{delivery.eventId}</code>
          </summary>
          <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono">
            {JSON.stringify(delivery.payload, null, 2)}
          </pre>
        </details>
        {delivery.status === 'pending' ? null : (
          <Button
            variant="outline"
            size="sm"
            disabled={resend.isPending}
            onClick={() =>
              resend.mutate(delivery, {
                onSuccess: () => toast.success(t('deliveries.resent')),
                onError: (error) => toast.error(errorMessage(tc, error)),
              })
            }
          >
            <RotateCw aria-hidden />
            {t('deliveries.resend')}
          </Button>
        )}
      </div>
    </li>
  );
}

/** The delivery log of one endpoint, newest first, with a status filter and resend. */
export function DeliveriesSheet({
  endpoint,
  onClose,
}: {
  endpoint: WebhookEndpointDto | null;
  onClose: () => void;
}) {
  const { t } = useTranslation('developer');
  const [status, setStatus] = useState<string>(ALL);
  const filter = status === ALL ? undefined : WebhookDeliveryStatus.parse(status);
  const deliveries = useWebhookDeliveries(endpoint?.id ?? null, filter);
  const rows = deliveries.data?.pages.flatMap((p) => p.data) ?? [];

  return (
    <Sheet open={endpoint !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{t('deliveries.title')}</SheetTitle>
          <SheetDescription className="break-all">
            {t('deliveries.description', { url: endpoint?.url ?? '' })}
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-3 px-4 pb-4">
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="h-9 w-44" aria-label={t('deliveries.all')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t('deliveries.all')}</SelectItem>
              {WebhookDeliveryStatus.options.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`deliveries.status.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {deliveries.isPending ? (
            <Skeleton className="h-40" />
          ) : deliveries.isError ? (
            <p className="text-sm text-destructive">{t('common.loadError')}</p>
          ) : rows.length ? (
            <ol className="divide-y rounded-xl border">
              {rows.map((d) => (
                <DeliveryRow key={d.id} delivery={d} />
              ))}
            </ol>
          ) : (
            <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              {t('deliveries.empty')}
            </p>
          )}
          {deliveries.hasNextPage ? (
            <div>
              <Button
                variant="outline"
                disabled={deliveries.isFetchingNextPage}
                onClick={() => void deliveries.fetchNextPage()}
              >
                {t('deliveries.more')}
              </Button>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
