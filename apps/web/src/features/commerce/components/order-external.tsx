import type { OrderDto, OrderSummaryDto } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import { LoaderCircle, RotateCw } from 'lucide-react';
import { createContext, useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ApiClientError } from '@/lib/api-client';
import { errorMessage } from '@/lib/errors';
import { useCan } from '@/lib/permissions';

import { Panel } from './order-detail-parts';

type External = NonNullable<OrderSummaryDto['external']>;

/**
 * "Thử lại" for a failed KiotViet push. The route passes it in (the integration feature owns the
 * call); the orders list hands it to its cells through this context.
 */
export type RetryOrderPush = (orderId: string) => Promise<unknown>;
const RetryPushContext = createContext<RetryOrderPush | undefined>(undefined);
export const RetryPushProvider = RetryPushContext.Provider;

/** The sentence for a failed push; codes without copy fall back to a generic one. */
export function pushErrorMessage(t: TFunction, error: External['error']): string {
  const generic = t('orders.push.errors.generic');
  if (!error) return generic;
  return t(`orders.push.errors.${error.code}`, { ...error.params, defaultValue: generic });
}

/** Short state text: "Đang đẩy", "Đã đẩy · <code>", "Lỗi" (also the CSV value). */
export function pushStateLabel(t: TFunction, external: External): string {
  if (external.state === 'pending') return t('orders.push.pending');
  if (external.state === 'failed') return t('orders.push.failed');
  return external.code
    ? t('orders.push.pushed', { code: external.code })
    : t('orders.push.pushedNoCode');
}

/** The retry action, or null without a callback or without `orders.manage`. */
function useRetryPush(onRetry: RetryOrderPush | undefined) {
  const { t } = useTranslation();
  const canManage = useCan('orders.manage');
  const fromContext = useContext(RetryPushContext);
  const [pending, setPending] = useState(false);
  const retry = onRetry ?? fromContext;
  if (!retry || !canManage) return null;
  const run = async (orderId: string) => {
    setPending(true);
    try {
      await retry(orderId);
      toast.success(t('orders.push.retried'));
    } catch (err) {
      toast.error(
        err instanceof ApiClientError && err.status === 409
          ? t('orders.push.notFailed')
          : errorMessage(t, err),
      );
    } finally {
      setPending(false);
    }
  };
  return { run, pending };
}

function RetryButton({
  orderId,
  action,
}: {
  orderId: string;
  action: NonNullable<ReturnType<typeof useRetryPush>>;
}) {
  const { t } = useTranslation();
  return (
    <Button
      variant="outline"
      size="xs"
      disabled={action.pending}
      onClick={(e) => {
        // Inside a clickable row: retry without opening the order.
        e.stopPropagation();
        void action.run(orderId);
      }}
    >
      {action.pending ? (
        <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
      ) : (
        <RotateCw aria-hidden />
      )}
      {t('orders.push.retry')}
    </Button>
  );
}

function StateBadge({ external }: { external: External }) {
  const { t } = useTranslation();
  const label = pushStateLabel(t, external);
  if (external.state === 'pending') {
    return (
      <Badge variant="secondary">
        <LoaderCircle aria-hidden className="motion-safe:animate-spin" />
        {label}
      </Badge>
    );
  }
  if (external.state === 'pushed') {
    return (
      <Badge variant="outline" className="tabular-nums">
        {label}
      </Badge>
    );
  }
  return <Badge variant="destructive">{label}</Badge>;
}

/**
 * The order's KiotViet push state in the orders list (spec §7): nothing when never pushed; a failed
 * push shows why on hover/focus and, with `orders.manage`, "Thử lại".
 */
export function OrderExternalChip({
  order,
  onRetry,
  withRetry = true,
}: {
  order: Pick<OrderSummaryDto, 'id' | 'external'>;
  onRetry?: RetryOrderPush;
  /** False inside a link (the mobile card): the bare chip, no tooltip and no button. */
  withRetry?: boolean;
}) {
  const { t } = useTranslation();
  const action = useRetryPush(onRetry);
  const external = order.external;
  if (!external) return null;
  // Inside the card link nothing may take focus: the order page explains the failure.
  if (external.state !== 'failed' || !withRetry) return <StateBadge external={external} />;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className="rounded-4xl focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
          >
            <StateBadge external={external} />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-64">{pushErrorMessage(t, external.error)}</TooltipContent>
      </Tooltip>
      {action ? <RetryButton orderId={order.id} action={action} /> : null}
    </span>
  );
}

/** The KiotViet card of the order page: state, why it failed, "Thử lại", where to update it. */
export function OrderPushPanel({ order, onRetry }: { order: OrderDto; onRetry?: RetryOrderPush }) {
  const { t } = useTranslation();
  const action = useRetryPush(onRetry);
  const external = order.external;
  if (!external) return null;
  return (
    <Panel
      title={t('orders.col.kiotviet')}
      action={
        external.state === 'failed' && action ? (
          <RetryButton orderId={order.id} action={action} />
        ) : null
      }
    >
      <div className="flex flex-col items-start gap-2 text-sm">
        <StateBadge external={external} />
        {external.state === 'failed' ? (
          <p className="text-destructive">{pushErrorMessage(t, external.error)}</p>
        ) : null}
        {external.state === 'pending' ? (
          <p className="text-muted-foreground">{t('orders.push.pendingNote')}</p>
        ) : null}
        {external.state === 'pushed' && external.status ? (
          <p>
            {t('orders.push.externalStatus', {
              status: t(`orders.push.status.${external.status}`, {
                defaultValue: external.status,
              }),
            })}
          </p>
        ) : null}
        {external.state === 'pushed' ? (
          <p className="text-muted-foreground">{t('orders.push.pushedNote')}</p>
        ) : null}
      </div>
    </Panel>
  );
}
