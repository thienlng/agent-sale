import type { OrderDto, OrderStatus } from '@agent-sales/contracts';
import { Link } from '@tanstack/react-router';
import { ChevronLeft, Pencil } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { MoneyInput } from '@/components/money-input';
import { NotFound } from '@/components/route-errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ApiClientError } from '@/lib/api-client';
import { formatDateTime, formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useChangeOrderStatus, useOrder, useUpdateOrder } from '../api/commerce';
import { orderErrorMessage } from '../hooks/order-errors';
import { useOrderStatuses } from '../hooks/use-order-statuses';
import { OrderItemsEditor } from './order-items-editor';
import { OrderPeoplePanel } from './order-people-editor';
import { OrderStatusBadge } from './order-status-badge';

function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border bg-card p-4 md:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-4', strong && 'font-semibold')}>
      <dt className={strong ? undefined : 'text-muted-foreground'}>{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

function StatusChanger({ order }: { order: OrderDto }) {
  const { t } = useTranslation();
  const { statuses, requireNote } = useOrderStatuses();
  const change = useChangeOrderStatus(order.id);
  const [status, setStatus] = useState<OrderStatus>(order.status);
  const [note, setNote] = useState('');
  useEffect(() => setStatus(order.status), [order.status]);
  const needsNote = requireNote.has(status);

  return (
    <div className="flex flex-col gap-3">
      <Select value={status} onValueChange={(v) => setStatus(v as OrderStatus)}>
        <SelectTrigger aria-label={t('orderDetail.changeStatus')} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(statuses.includes(order.status) ? statuses : [order.status, ...statuses]).map((s) => (
            <SelectItem key={s} value={s}>
              {t(`status.${s}`)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Textarea
        rows={2}
        maxLength={1000}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={needsNote ? t('orderDetail.noteRequired') : t('orderDetail.note')}
        aria-label={t('orderDetail.note')}
      />
      <Button
        disabled={status === order.status || change.isPending || (needsNote && !note.trim())}
        onClick={() =>
          change.mutate(
            { status, ...(note.trim() ? { note: note.trim() } : {}) },
            {
              onSuccess: () => {
                setNote('');
                toast.success(t('orderDetail.statusChanged', { status: t(`status.${status}`) }));
              },
              onError: (err) => toast.error(orderErrorMessage(t, err)),
            },
          )
        }
      >
        {t('orderDetail.apply')}
      </Button>
    </div>
  );
}

/** Shipping, payment received and notes: the parts of an order that change after creation. */
function EditablePanel({ order }: { order: OrderDto }) {
  const { t } = useTranslation();
  const update = useUpdateOrder(order.id);
  const [editing, setEditing] = useState(false);
  const [carrier, setCarrier] = useState(order.carrier ?? '');
  const [trackingCode, setTrackingCode] = useState(order.trackingCode ?? '');
  const [shippingFee, setShippingFee] = useState(order.amounts.shippingFee);
  const [transferAmount, setTransferAmount] = useState(order.amounts.transferAmount);
  const [noteInternal, setNoteInternal] = useState(order.noteInternal);
  const [notePrint, setNotePrint] = useState(order.notePrint);

  const reset = () => {
    setCarrier(order.carrier ?? '');
    setTrackingCode(order.trackingCode ?? '');
    setShippingFee(order.amounts.shippingFee);
    setTransferAmount(order.amounts.transferAmount);
    setNoteInternal(order.noteInternal);
    setNotePrint(order.notePrint);
  };

  if (!editing) {
    return (
      <Panel
        title={`${t('orderDetail.shipping')} · ${t('orderDetail.notes')}`}
        action={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              // Start from the latest saved values (the order may have changed meanwhile).
              reset();
              setEditing(true);
            }}
          >
            <Pencil />
            {t('orderDetail.edit')}
          </Button>
        }
      >
        <dl className="flex flex-col gap-2 text-sm">
          <Row label={t('orderForm.carrier')} value={order.carrier ?? '—'} />
          <Row label={t('orderForm.tracking')} value={order.trackingCode ?? '—'} />
          <Row label={t('orderDetail.carrierFee')} value={formatVnd(order.amounts.shippingFee)} />
          <Row label={t('orderDetail.warehouse')} value={order.warehouseName} />
        </dl>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
          <div>
            <div className="text-muted-foreground">{t('orderForm.noteInternal')}</div>
            <p className="mt-1 whitespace-pre-line">{order.noteInternal || '—'}</p>
          </div>
          <div>
            <div className="text-muted-foreground">{t('orderForm.notePrint')}</div>
            <p className="mt-1 whitespace-pre-line">{order.notePrint || '—'}</p>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <Panel title={`${t('orderDetail.shipping')} · ${t('orderDetail.notes')}`}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="od-carrier">{t('orderForm.carrier')}</Label>
          <Input
            id="od-carrier"
            maxLength={60}
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="od-tracking">{t('orderForm.tracking')}</Label>
          <Input
            id="od-tracking"
            maxLength={60}
            value={trackingCode}
            onChange={(e) => setTrackingCode(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="od-fee">{t('orderDetail.carrierFee')}</Label>
          <MoneyInput id="od-fee" value={shippingFee} onValueChange={setShippingFee} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="od-transfer">{t('orderDetail.transferEdit')}</Label>
          <MoneyInput id="od-transfer" value={transferAmount} onValueChange={setTransferAmount} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="od-note-i">{t('orderForm.noteInternal')}</Label>
          <Textarea
            id="od-note-i"
            rows={3}
            maxLength={2000}
            value={noteInternal}
            onChange={(e) => setNoteInternal(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="od-note-p">{t('orderForm.notePrint')}</Label>
          <Textarea
            id="od-note-p"
            rows={3}
            maxLength={2000}
            value={notePrint}
            onChange={(e) => setNotePrint(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button
          variant="ghost"
          onClick={() => {
            reset();
            setEditing(false);
          }}
        >
          {t('orderDetail.cancel')}
        </Button>
        <Button
          disabled={update.isPending}
          onClick={() =>
            update.mutate(
              {
                carrier: carrier.trim() || null,
                trackingCode: trackingCode.trim() || null,
                shippingFee,
                transferAmount,
                noteInternal,
                notePrint,
              },
              {
                onSuccess: () => {
                  toast.success(t('orderDetail.saved'));
                  setEditing(false);
                },
                onError: (err) => toast.error(orderErrorMessage(t, err)),
              },
            )
          }
        >
          {t('orderDetail.save')}
        </Button>
      </div>
    </Panel>
  );
}

export function OrderDetail({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const query = useOrder(orderId);
  const [editingItems, setEditingItems] = useState(false);
  if (query.error instanceof ApiClientError && query.error.status === 404) return <NotFound />;
  const order = query.data;
  if (!order) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }
  const a = order.amounts;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <Link
          to="/app/orders"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" aria-hidden />
          {t('orderDetail.back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight tabular-nums">{order.code}</h1>
          <OrderStatusBadge status={order.status} className="text-sm" />
          <span className="text-sm text-muted-foreground">
            {formatDateTime(order.placedAt)} · {t(`source.${order.source}`)}
            {order.createdByName
              ? ` · ${t('orderDetail.createdBy', { name: order.createdByName })}`
              : ''}
          </span>
        </div>
      </header>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {editingItems && order.stockState === 'reserved' ? (
            <OrderItemsEditor order={order} onDone={() => setEditingItems(false)} />
          ) : (
            <>
              <Panel
                title={t('orderDetail.items')}
                action={
                  order.stockState === 'reserved' ? (
                    <Button variant="ghost" size="sm" onClick={() => setEditingItems(true)}>
                      <Pencil />
                      {t('orderDetail.editItems')}
                    </Button>
                  ) : null
                }
              >
                <ul className="divide-y">
                  {order.items.map((i) => (
                    <li key={i.id} className="flex flex-wrap items-center gap-3 py-2.5">
                      <div className="min-w-0 flex-1 basis-48">
                        <div className="truncate font-medium">{i.productName}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[i.variantName, i.sku].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <div className="text-sm text-muted-foreground tabular-nums">
                        {i.qty} × {formatVnd(i.unitPrice)}
                      </div>
                      <div className="w-28 text-right font-medium tabular-nums">
                        {formatVnd(i.lineTotal)}
                      </div>
                    </li>
                  ))}
                </ul>
              </Panel>

              <Panel title={t('orderDetail.amounts')}>
                <dl className="flex flex-col gap-2 text-sm">
                  <Row label={t('orderForm.subtotal')} value={formatVnd(a.subtotal)} />
                  <Row
                    label={t('orderForm.shippingCharged')}
                    value={
                      a.freeShipping ? t('orderForm.freeShipping') : formatVnd(a.shippingFeeCharged)
                    }
                  />
                  <Row label={t('orderForm.surcharge')} value={formatVnd(a.surcharge)} />
                  <Row label={t('orderForm.gross')} value={formatVnd(a.gross)} />
                  <Row
                    label={`${t('orderForm.discount')}${a.discountType === 'percent' ? ` (${a.discountValue}%)` : ''}`}
                    value={formatVnd(a.discountAmount ? -a.discountAmount : 0)}
                  />
                  <div className="my-1 border-t" />
                  <Row strong label={t('orderForm.total')} value={formatVnd(a.total)} />
                  <Row label={t('orderForm.paid')} value={formatVnd(a.paid)} />
                  <Row
                    strong
                    label={a.remaining < 0 ? t('orderForm.overpaid') : t('orderForm.cod')}
                    value={formatVnd(Math.abs(a.remaining))}
                  />
                </dl>
              </Panel>
            </>
          )}

          <OrderPeoplePanel key={order.id} order={order} />

          <EditablePanel key={order.id} order={order} />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <Panel title={t('orderDetail.changeStatus')}>
            <StatusChanger order={order} />
            <p className="mt-3 text-xs text-muted-foreground">
              {t(`orderDetail.stock.${order.stockState}`)}
            </p>
          </Panel>
          <Panel title={t('orderDetail.history')}>
            <ol className="relative flex flex-col gap-4 border-l pl-5">
              {[...order.history].reverse().map((h, idx) => (
                <li key={idx} className="relative">
                  <span
                    className={cn(
                      'absolute top-1.5 -left-[25px] size-2.5 rounded-full ring-4 ring-background',
                      idx === 0 ? 'bg-primary' : 'bg-border',
                    )}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <OrderStatusBadge status={h.toStatus} />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatDateTime(h.at)}
                    </span>
                  </div>
                  {h.actorName ? (
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t('orderDetail.by', { name: h.actorName })}
                    </div>
                  ) : null}
                  {h.note ? <p className="mt-1 text-sm whitespace-pre-line">{h.note}</p> : null}
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}
