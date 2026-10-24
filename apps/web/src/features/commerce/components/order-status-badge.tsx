import type { OrderStatus } from '@agent-sales/contracts';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

/** Colour by stage: waiting (amber), being handled (brand), on the road (blue), done (green), failed (red). */
const TONE: Record<OrderStatus, string> = {
  new: 'bg-secondary text-secondary-foreground',
  awaiting_confirmation: 'bg-warning-soft text-warning',
  ordered: 'bg-warning-soft text-warning',
  confirmed: 'bg-primary-soft text-accent-foreground',
  packing: 'bg-primary-soft text-accent-foreground',
  awaiting_print: 'bg-primary-soft text-accent-foreground',
  printed: 'bg-primary-soft text-accent-foreground',
  awaiting_handover: 'bg-primary-soft text-accent-foreground',
  delivering: 'bg-chart-3/15 text-chart-3',
  delivered: 'bg-success-soft text-success',
  delivery_failed: 'bg-destructive-soft text-destructive',
  returning: 'bg-warning-soft text-warning',
  returned: 'bg-secondary text-muted-foreground',
  cancelled: 'bg-destructive-soft text-destructive',
};

export function OrderStatusBadge({
  status,
  className,
}: {
  status: OrderStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE[status],
        className,
      )}
    >
      {t(`status.${status}`)}
    </span>
  );
}
