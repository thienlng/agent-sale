import { OrderSource, type OrderStatus } from '@agent-sales/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { ChevronLeft, ChevronRight, PackageOpen, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DateRangePicker } from '@/components/date-range-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ApiClientError } from '@/lib/api-client';
import { formatDateTime, formatNumber, formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';

import { useOrders } from '../api/commerce';
import { useOrderStatuses } from '../hooks/use-order-statuses';
import { OrderStatusBadge } from './order-status-badge';

/** List state kept in the URL (shareable, survives back/forward). */
export interface OrdersSearch {
  status?: OrderStatus | undefined;
  q?: string | undefined;
  source?: OrderSource | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort?: 'placed_desc' | 'placed_asc' | 'total_desc' | 'total_asc' | undefined;
  page?: number | undefined;
}

const SORTS = ['placed_desc', 'placed_asc', 'total_desc', 'total_asc'] as const;
const ALL = '__all';

/** Order list (ORD-04): status tabs with counts, search, date/source filters, sort, totals. */
export function OrdersList({
  search,
  onSearch,
}: {
  search: OrdersSearch;
  onSearch: (next: OrdersSearch) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { statuses } = useOrderStatuses();
  const page = search.page ?? 1;
  const orders = useOrders({ ...search, page, pageSize: 20 });
  const [text, setText] = useState(search.q ?? '');

  // Search as you type, without a request per keystroke.
  useEffect(() => {
    const id = setTimeout(() => {
      if ((search.q ?? '') !== text) onSearch({ ...search, q: text || undefined, page: 1 });
    }, 300);
    return () => clearTimeout(id);
  }, [text, search, onSearch]);

  const set = (patch: Partial<OrdersSearch>) =>
    onSearch({ ...search, ...patch, page: patch.page ?? 1 });
  const data = orders.data;
  const counts = data?.counts ?? {};
  const unavailable = orders.error instanceof ApiClientError && orders.error.status === 503;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('orders.title')}</h1>
        <Button size="lg" asChild>
          <Link to="/app/orders/new">
            <Plus />
            {t('orders.add')}
          </Link>
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-60 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('orders.search')}
            aria-label={t('orders.search')}
            className="h-9 pl-9"
          />
        </div>
        <DateRangePicker
          allowClear
          value={search.from && search.to ? { from: search.from, to: search.to } : null}
          onChange={(r) => set({ from: r?.from, to: r?.to })}
        />
        <Select
          value={search.source ?? ALL}
          onValueChange={(v) => set({ source: v === ALL ? undefined : (v as OrderSource) })}
        >
          <SelectTrigger className="h-9 w-40" aria-label={t('orders.source')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t('orders.allSources')}</SelectItem>
            {OrderSource.options.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`source.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={search.sort ?? 'placed_desc'}
          onValueChange={(v) => set({ sort: v as OrdersSearch['sort'] })}
        >
          <SelectTrigger className="h-9 w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => (
              <SelectItem key={s} value={s}>
                {t(`orders.sort.${s}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Status tabs scroll sideways inside their own strip on narrow screens. */}
      <nav aria-label={t('orders.col.status')} className="-mx-1 overflow-x-auto">
        <div className="flex min-w-max gap-1 px-1 pb-1">
          {([undefined, ...statuses] as Array<OrderStatus | undefined>).map((s) => {
            const active = search.status === s;
            return (
              <button
                key={s ?? 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => set({ status: s })}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm whitespace-nowrap transition-colors',
                  'focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none',
                  active
                    ? 'border-primary bg-primary-soft font-medium text-accent-foreground'
                    : 'hover:bg-muted',
                )}
              >
                {s ? t(`status.${s}`) : t('orders.all')}
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatNumber(counts[s ?? 'all'] ?? 0)}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {/* Phones: one card per order; the full table from md up. */}
      <ul className="flex flex-col gap-2 md:hidden">
        {data?.data.map((o) => (
          <li key={o.id}>
            <Link
              to="/app/orders/$orderId"
              params={{ orderId: o.id }}
              className="flex flex-col gap-2 rounded-xl border bg-card p-3 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-primary tabular-nums">{o.code}</span>
                <OrderStatusBadge status={o.status} />
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{o.customer.name}</span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatVnd(o.amounts.total)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span className="tabular-nums">{formatDateTime(o.placedAt)}</span>
                <span className="tabular-nums">
                  {t('orders.col.cod')}: {formatVnd(o.amounts.cod)}
                </span>
              </div>
            </Link>
          </li>
        ))}
        {data && !data.data.length ? (
          <li className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {counts['all'] ? t('orders.empty') : t('orders.emptyStart')}
          </li>
        ) : null}
        {data?.total ? (
          <li className="flex justify-between rounded-xl bg-muted/50 p-3 text-sm font-medium">
            <span>{t('orders.footer.total')}</span>
            <span className="tabular-nums">{formatVnd(data.totals.total)}</span>
          </li>
        ) : null}
      </ul>

      <div className="hidden overflow-hidden rounded-xl border md:block">
        <div className="overflow-x-auto">
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead>{t('orders.col.code')}</TableHead>
                <TableHead>{t('orders.col.customer')}</TableHead>
                <TableHead>{t('orders.col.address')}</TableHead>
                <TableHead>{t('orders.col.products')}</TableHead>
                <TableHead className="text-right">{t('orders.col.total')}</TableHead>
                <TableHead className="text-right">{t('orders.col.cod')}</TableHead>
                <TableHead>{t('orders.col.source')}</TableHead>
                <TableHead>{t('orders.col.placedAt')}</TableHead>
                <TableHead>{t('orders.col.status')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.isPending
                ? Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={9}>
                        <Skeleton className="h-8" />
                      </TableCell>
                    </TableRow>
                  ))
                : data?.data.map((o) => (
                    <TableRow
                      key={o.id}
                      className="cursor-pointer"
                      onClick={() =>
                        void navigate({ to: '/app/orders/$orderId', params: { orderId: o.id } })
                      }
                    >
                      <TableCell className="align-top">
                        <Link
                          to="/app/orders/$orderId"
                          params={{ orderId: o.id }}
                          className="font-medium text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {o.code}
                        </Link>
                        {o.trackingCode ? (
                          <div className="text-xs text-muted-foreground">{o.trackingCode}</div>
                        ) : null}
                      </TableCell>
                      <TableCell className="max-w-48 align-top">
                        <div className="truncate font-medium">{o.customer.name}</div>
                        <div className="text-xs text-muted-foreground tabular-nums">
                          {o.customer.phone}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-56 align-top whitespace-normal text-muted-foreground">
                        <span className="line-clamp-2">{o.recipient.address}</span>
                      </TableCell>
                      <TableCell className="max-w-64 align-top whitespace-normal">
                        {o.itemsPreview.map((i, idx) => (
                          <div key={idx} className="truncate">
                            <span className="tabular-nums">{i.qty}×</span> {i.name}
                          </div>
                        ))}
                      </TableCell>
                      <TableCell className="text-right align-top font-medium tabular-nums">
                        {formatVnd(o.amounts.total)}
                      </TableCell>
                      <TableCell className="text-right align-top tabular-nums">
                        {formatVnd(o.amounts.cod)}
                      </TableCell>
                      <TableCell className="align-top">
                        <div>{t(`source.${o.source}`)}</div>
                        {o.createdByName ? (
                          <div className="max-w-32 truncate text-xs text-muted-foreground">
                            {o.createdByName}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="align-top text-muted-foreground tabular-nums">
                        {formatDateTime(o.placedAt)}
                      </TableCell>
                      <TableCell className="align-top">
                        <OrderStatusBadge status={o.status} />
                      </TableCell>
                    </TableRow>
                  ))}
              {data && !data.data.length ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="py-14 text-center text-muted-foreground">
                    <PackageOpen className="mx-auto mb-3 size-8 text-primary" aria-hidden />
                    {counts['all'] ? t('orders.empty') : t('orders.emptyStart')}
                  </TableCell>
                </TableRow>
              ) : null}
              {unavailable ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={9} className="py-14 text-center text-muted-foreground">
                    {t('orders.unavailable')}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
            {data?.total ? (
              <TableFooter>
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={3} className="font-medium">
                    {t('orders.footer.qty')}:{' '}
                    <span className="tabular-nums">{formatNumber(data.totals.itemQty)}</span>
                    <span className="ml-4 font-normal text-muted-foreground">
                      {t('orders.footer.shipping')}: {formatVnd(data.totals.shippingFeeCharged)}
                    </span>
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatVnd(data.totals.total)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatVnd(data.totals.cod)}
                  </TableCell>
                  <TableCell colSpan={3} />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </div>
      </div>

      {data && data.total > data.pageSize ? (
        <div className="flex items-center justify-end gap-3 text-sm">
          <span className="text-muted-foreground">
            {t('orders.pageInfo', {
              from: (page - 1) * data.pageSize + 1,
              to: Math.min(page * data.pageSize, data.total),
              total: data.total,
            })}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page <= 1}
            onClick={() => set({ page: page - 1 })}
            aria-label={t('orders.prevPage')}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={page >= pages}
            onClick={() => set({ page: page + 1 })}
            aria-label={t('orders.nextPage')}
          >
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </section>
  );
}
