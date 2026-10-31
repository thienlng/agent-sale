import type { OrderSummaryDto } from '@agent-sales/contracts';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useSyncExternalStore } from 'react';

import { formatDateTime, formatVnd } from '@/lib/format';
import { storage } from '@/lib/storage';

import { OrderCreatedByCell } from './order-created-by-cell';
import { OrderItemsHoverCard } from './order-items-hover-card';
import { OrderStatusBadge } from './order-status-badge';

export interface OrderColumn {
  id: string;
  /** i18n key of the header. */
  header: string;
  align?: 'right';
  /** Shown until the user changes the column set. */
  defaultVisible: boolean;
  /** Cannot be hidden (identifies the row). */
  fixed?: boolean;
  className?: string;
  cell: (o: OrderSummaryDto, t: TFunction) => ReactNode;
  /** Plain value for the CSV export. */
  csv: (o: OrderSummaryDto, t: TFunction) => string | number;
}

const products = (o: OrderSummaryDto) =>
  o.itemsPreview.map((i) => `${i.qty}× ${i.name}`).join('; ');
const address = (o: OrderSummaryDto) =>
  [o.recipient.address, o.recipient.ward, o.recipient.province].filter(Boolean).join(', ');

/** Every column the list can show (docs/02 ORD-04), in display order. */
export const ORDER_COLUMNS: readonly OrderColumn[] = [
  {
    id: 'code',
    header: 'orders.col.code',
    defaultVisible: true,
    fixed: true,
    cell: (o) => <span className="font-medium text-primary tabular-nums">{o.code}</span>,
    csv: (o) => o.code,
  },
  {
    id: 'tracking',
    header: 'orders.col.tracking',
    defaultVisible: false,
    cell: (o) => (
      <span className="text-muted-foreground tabular-nums">{o.trackingCode ?? '—'}</span>
    ),
    csv: (o) => o.trackingCode ?? '',
  },
  {
    id: 'customer',
    header: 'orders.col.customer',
    defaultVisible: true,
    className: 'max-w-48',
    cell: (o) => (
      <>
        <div className="truncate font-medium">{o.customer.name}</div>
        <div className="text-xs text-muted-foreground tabular-nums">{o.customer.phone}</div>
      </>
    ),
    csv: (o) => o.customer.name,
  },
  {
    id: 'phone',
    header: 'orders.col.phone',
    defaultVisible: false,
    cell: (o) => <span className="tabular-nums">{o.recipient.phone ?? '—'}</span>,
    csv: (o) => o.recipient.phone ?? '',
  },
  {
    id: 'address',
    header: 'orders.col.address',
    defaultVisible: false,
    className: 'max-w-60 whitespace-normal',
    cell: (o) => <span className="line-clamp-2 text-muted-foreground">{address(o)}</span>,
    csv: address,
  },
  {
    id: 'products',
    header: 'orders.col.products',
    defaultVisible: true,
    className: 'max-w-72 whitespace-normal',
    cell: (o) => <OrderItemsHoverCard order={o} />,
    csv: products,
  },
  {
    id: 'carrier',
    header: 'orders.col.carrier',
    defaultVisible: false,
    cell: (o) => o.carrier ?? '—',
    csv: (o) => o.carrier ?? '',
  },
  {
    id: 'subtotal',
    header: 'orders.col.subtotal',
    align: 'right',
    defaultVisible: false,
    cell: (o) => formatVnd(o.amounts.subtotal),
    csv: (o) => o.amounts.subtotal,
  },
  {
    id: 'shipping',
    header: 'orders.col.shipping',
    align: 'right',
    defaultVisible: false,
    cell: (o) => formatVnd(o.amounts.shippingFeeCharged),
    csv: (o) => o.amounts.shippingFeeCharged,
  },
  {
    id: 'gross',
    header: 'orders.col.gross',
    align: 'right',
    defaultVisible: false,
    cell: (o) => formatVnd(o.amounts.gross),
    csv: (o) => o.amounts.gross,
  },
  {
    id: 'total',
    header: 'orders.col.total',
    align: 'right',
    defaultVisible: true,
    cell: (o) => <span className="font-medium">{formatVnd(o.amounts.total)}</span>,
    csv: (o) => o.amounts.total,
  },
  {
    id: 'paid',
    header: 'orders.col.paid',
    align: 'right',
    defaultVisible: false,
    cell: (o) => formatVnd(o.amounts.paid),
    csv: (o) => o.amounts.paid,
  },
  {
    id: 'cod',
    header: 'orders.col.cod',
    align: 'right',
    defaultVisible: true,
    cell: (o) => formatVnd(o.amounts.cod),
    csv: (o) => o.amounts.cod,
  },
  {
    id: 'note',
    header: 'orders.col.note',
    defaultVisible: false,
    className: 'max-w-56 whitespace-normal',
    cell: (o) => (
      <span className="line-clamp-2 text-muted-foreground">{o.noteInternal || '—'}</span>
    ),
    csv: (o) => o.noteInternal,
  },
  {
    id: 'source',
    header: 'orders.col.source',
    defaultVisible: true,
    cell: (o, t) => t(`source.${o.source}`),
    csv: (o, t) => t(`source.${o.source}`),
  },
  {
    // A new id (was `createdBy`, hidden): saved column choices pick it up as a new column.
    id: 'creator',
    header: 'orders.col.createdBy',
    defaultVisible: true,
    className: 'w-55 min-w-55 max-w-60',
    cell: (o) => <OrderCreatedByCell order={o} />,
    csv: (o, t) =>
      o.createdByKind === 'bot'
        ? `${t('orders.review.bot')} · ${t(o.reviewState === 'pending' ? 'orders.review.pending' : 'orders.review.approved')}`
        : (o.createdByName ?? ''),
  },
  {
    id: 'placedAt',
    header: 'orders.col.placedAt',
    defaultVisible: true,
    cell: (o) => (
      <span className="text-muted-foreground tabular-nums">{formatDateTime(o.placedAt)}</span>
    ),
    csv: (o) => o.placedAt,
  },
  {
    id: 'status',
    header: 'orders.col.status',
    defaultVisible: true,
    fixed: true,
    cell: (o) => <OrderStatusBadge status={o.status} />,
    csv: (o, t) => t(`status.${o.status}`),
  },
];

// ─── Column choice, remembered per browser ────────────────────────────────────

const KEY = 'rapiz.orders.columns.v2';
/** Choices saved before "Người tạo" became a default column (then `createdBy`, hidden). */
const LEGACY_KEY = 'rapiz.orders.columns';
const listeners = new Set<() => void>();

function savedIds(): string[] | null {
  const saved = storage.get(KEY);
  if (saved) return saved.split(',');
  const legacy = storage.get(LEGACY_KEY);
  return legacy ? [...legacy.split(',').filter((id) => id !== 'createdBy'), 'creator'] : null;
}

function read(): ReadonlySet<string> {
  const ids = savedIds() ?? ORDER_COLUMNS.filter((c) => c.defaultVisible).map((c) => c.id);
  return new Set([...ids, ...ORDER_COLUMNS.filter((c) => c.fixed).map((c) => c.id)]);
}

let visible = read();

export function toggleOrderColumn(id: string): void {
  const next = new Set(visible);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  visible = next;
  storage.set(KEY, [...next].join(','));
  listeners.forEach((l) => l());
}

export function resetOrderColumns(): void {
  storage.remove(KEY);
  storage.remove(LEGACY_KEY);
  visible = read();
  listeners.forEach((l) => l());
}

export function useVisibleOrderColumns(): OrderColumn[] {
  const ids = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => visible,
  );
  return ORDER_COLUMNS.filter((c) => ids.has(c.id));
}
