import type { OrderItemPreview, OrderSummaryDto } from '@agent-sales/contracts';
import { Package } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import { formatVnd } from '@/lib/format';

export const ITEMS_CARD_OPEN_DELAY_MS = 300;
export const ITEMS_CARD_CLOSE_DELAY_MS = 100;
/** Lines shown in the table cell; the card lists every preview line (up to 10). */
export const CELL_LINES = 3;

/** The preview name is "product – variant"; the card shows the variant on its own line. */
function productName(item: OrderItemPreview): string {
  const suffix = item.variantName ? ` – ${item.variantName}` : '';
  return suffix && item.name.endsWith(suffix) ? item.name.slice(0, -suffix.length) : item.name;
}

/** A 40×40 product picture; a muted square with a package icon when there is none or it fails. */
function Thumb({ src }: { src: string | null }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        aria-hidden
        data-slot="thumb-fallback"
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
      >
        <Package className="size-4" aria-hidden />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      width={40}
      height={40}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
      className="size-10 shrink-0 rounded-md bg-muted object-cover"
    />
  );
}

/**
 * The products cell of the orders list: one truncated `qty× name` line per item, and on hover
 * or keyboard focus a card with the full names, variants, prices and the total (spec §6.4).
 * The same lines are on the order detail page, so nothing is reachable by hover only.
 */
export function OrderItemsHoverCard({
  order,
}: {
  order: Pick<OrderSummaryDto, 'code' | 'itemsPreview' | 'itemCount' | 'amounts'>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const summaryId = useId();
  const items = order.itemsPreview;
  if (!items.length) return <span className="text-muted-foreground">—</span>;
  const count = Math.max(order.itemCount, items.length);
  const hiddenInCell = count - Math.min(items.length, CELL_LINES);
  const hiddenInCard = count - items.length;

  return (
    <>
      <HoverCard
        open={open}
        onOpenChange={setOpen}
        openDelay={ITEMS_CARD_OPEN_DELAY_MS}
        closeDelay={ITEMS_CARD_CLOSE_DELAY_MS}
      >
        <HoverCardTrigger asChild>
          <div
            tabIndex={0}
            role="group"
            aria-label={t('orders.items.details', { code: order.code })}
            aria-describedby={summaryId}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && open) {
                e.stopPropagation();
                setOpen(false);
              }
            }}
            className="-mx-1 flex min-w-0 flex-col gap-0.5 rounded-md px-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {items.slice(0, CELL_LINES).map((i, idx) => (
              <span key={idx} className="truncate">
                <span className="text-muted-foreground tabular-nums">{i.qty}×</span> {i.name}
              </span>
            ))}
            {hiddenInCell > 0 ? (
              <span className="text-xs text-muted-foreground tabular-nums">+{hiddenInCell}</span>
            ) : null}
          </div>
        </HoverCardTrigger>
        <HoverCardContent align="start" className="flex max-h-90 w-80 flex-col gap-0 p-0">
          <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
            {t('orders.items.count', { count })}
          </p>
          <ul className="min-h-0 flex-1 divide-y overflow-y-auto px-3">
            {items.map((i, idx) => (
              <li key={idx} className="flex items-start gap-3 py-2">
                <Thumb src={i.imageUrl} />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 leading-snug font-medium break-words">
                    {productName(i)}
                  </p>
                  {i.variantName ? (
                    <p className="truncate text-xs text-muted-foreground">{i.variantName}</p>
                  ) : null}
                </div>
                <span className="shrink-0 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {i.qty} × {formatVnd(i.unitPrice)}
                </span>
              </li>
            ))}
            {hiddenInCard > 0 ? (
              <li className="py-2 text-xs text-muted-foreground">
                {t('orders.items.more', { count: hiddenInCard })}
              </li>
            ) : null}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t px-3 py-2 font-medium">
            <span>{t('orders.items.total')}</span>
            <span className="tabular-nums">{formatVnd(order.amounts.total)}</span>
          </div>
        </HoverCardContent>
      </HoverCard>
      {/* Always present (outside the trigger, so it is not read twice): the gist without the card. */}
      <span id={summaryId} className="sr-only">
        {t('orders.items.summary', { count, total: formatVnd(order.amounts.total) })}
      </span>
    </>
  );
}
