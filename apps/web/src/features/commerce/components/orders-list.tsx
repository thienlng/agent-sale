import type { OrderSummaryDto } from '@agent-sales/contracts';
import { Link, useNavigate } from '@tanstack/react-router';
import { Check, Copy, Eye, MoreHorizontal, PackageOpen, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { Pager } from '@/components/pager';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { errorMessage } from '@/lib/errors';
import { formatDateTime, formatNumber, formatVnd } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useCan } from '@/lib/permissions';

import { fetchAllOrders, useOrders } from '../api/commerce';
import { downloadOrdersCsv } from '../hooks/export-orders';
import { useApproveWithUndo } from '../hooks/use-approve-order';
import { useOrderStatuses } from '../hooks/use-order-statuses';
import { type OrderColumn, useVisibleOrderColumns } from './order-columns';
import { OrderStatusBadge } from './order-status-badge';
import { OrdersBulkBar } from './orders-bulk-bar';
import { type OrdersSearch, toOrderQuery } from './orders-search';
import { OrdersToolbar } from './orders-toolbar';

type Totals = {
  itemQty: number;
  shippingFeeCharged: number;
  cod: number;
  gross: number;
  total: number;
};

/** Footer value under a column: totals over every matching order, not only this page. */
function footerCell(col: OrderColumn, totals: Totals) {
  switch (col.id) {
    case 'products':
      return formatNumber(totals.itemQty);
    case 'shipping':
      return formatVnd(totals.shippingFeeCharged);
    case 'cod':
      return formatVnd(totals.cod);
    case 'gross':
      return formatVnd(totals.gross);
    case 'total':
      return formatVnd(totals.total);
    default:
      return null;
  }
}

function OrderCards({ rows }: { rows: OrderSummaryDto[] }) {
  const { t } = useTranslation();
  return (
    <ul className="flex flex-col gap-2 md:hidden">
      {rows.map((o) => (
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
    </ul>
  );
}

function RowMenu({
  order,
  onOpen,
  onApprove,
}: {
  order: OrderSummaryDto;
  onOpen: () => void;
  /** Set for a pending bot order the user may approve. */
  onApprove: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('orders.row.menu', { code: order.code })}
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {onApprove ? (
          <DropdownMenuItem onSelect={onApprove}>
            <Check />
            {t('orders.review.approve')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={onOpen}>
          <Eye />
          {t('orders.row.view')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void navigator.clipboard
              .writeText(order.code)
              .then(() => toast.success(t('orders.row.copied')))
          }
        >
          <Copy />
          {t('orders.row.copy')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Order list (ORD-04): filters, column choice, bulk status, CSV export, totals. */
export function OrdersList({
  search,
  onSearch,
}: {
  search: OrdersSearch;
  onSearch: (next: OrdersSearch) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const canAdd = useCan('orders.manage');
  const { statuses, requireNote } = useOrderStatuses();
  const columns = useVisibleOrderColumns();
  const page = search.page ?? 1;
  const pageSize = search.pageSize ?? 20;
  const orders = useOrders(toOrderQuery({ ...search, page, pageSize }));
  const [selected, setSelected] = useState<string[]>([]);
  const [exporting, setExporting] = useState(false);
  // Lives here, not in the row menu: the undo toast outlives the menu (and a filtered-out row).
  const { approve } = useApproveWithUndo();

  const data = orders.data;
  const rows = data?.data ?? [];
  const unavailable = orders.error instanceof ApiClientError && orders.error.status === 503;
  const allOnPage = rows.length > 0 && rows.every((o) => selected.includes(o.id));
  const colCount = columns.length + 2;

  const change = useCallback(
    (patch: Partial<OrdersSearch>) => onSearch({ ...search, ...patch, page: patch.page ?? 1 }),
    [search, onSearch],
  );
  // A different filter or page shows different rows: start the selection over.
  useEffect(() => setSelected([]), [search]);

  const exportCsv = async () => {
    setExporting(true);
    try {
      const { page: _page, pageSize: _size, ...filter } = search;
      const all = await fetchAllOrders(toOrderQuery(filter));
      downloadOrdersCsv(all, columns, t);
      toast.success(t('orders.filters.exported', { count: all.length }));
    } catch (err) {
      toast.error(errorMessage(t, err));
    } finally {
      setExporting(false);
    }
  };

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const open = (o: OrderSummaryDto) =>
    void navigate({ to: '/app/orders/$orderId', params: { orderId: o.id } });

  return (
    <section className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('orders.title')}</h1>
          {data ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t('orders.summary', { count: data.total, total: formatVnd(data.totals.total) })}
            </p>
          ) : null}
        </div>
        {canAdd ? (
          <Button size="lg" asChild>
            <Link to="/app/orders/new">
              <Plus />
              {t('orders.add')}
            </Link>
          </Button>
        ) : null}
      </header>

      <OrdersToolbar
        search={search}
        onChange={change}
        statuses={statuses}
        counts={data?.counts ?? {}}
        facets={data?.facets}
        onExport={() => void exportCsv()}
        exporting={exporting}
      />

      <OrdersBulkBar
        selected={selected}
        statuses={statuses}
        requireNote={requireNote}
        onDone={() => setSelected([])}
      />

      <OrderCards rows={rows} />

      <div className="hidden overflow-hidden rounded-xl border md:block">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">
                  <Checkbox
                    aria-label={t('orders.bulk.selectPage')}
                    checked={allOnPage ? true : selected.length ? 'indeterminate' : false}
                    onCheckedChange={(c) => setSelected(c === true ? rows.map((o) => o.id) : [])}
                  />
                </TableHead>
                {columns.map((c) => (
                  <TableHead
                    key={c.id}
                    className={cn(
                      'text-xs font-medium text-muted-foreground',
                      c.align === 'right' && 'text-right',
                    )}
                  >
                    {t(c.header)}
                  </TableHead>
                ))}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.isPending
                ? Array.from({ length: 6 }, (_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={colCount}>
                        <Skeleton className="h-7" />
                      </TableCell>
                    </TableRow>
                  ))
                : rows.map((o) => (
                    <TableRow
                      key={o.id}
                      data-state={selected.includes(o.id) ? 'selected' : undefined}
                      className="cursor-pointer"
                      onClick={() => open(o)}
                    >
                      <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          aria-label={t('orders.bulk.selectRow', { code: o.code })}
                          checked={selected.includes(o.id)}
                          onCheckedChange={() => toggle(o.id)}
                        />
                      </TableCell>
                      {columns.map((c) => (
                        <TableCell
                          key={c.id}
                          className={cn(
                            'align-top',
                            c.align === 'right' && 'text-right tabular-nums',
                            c.className,
                          )}
                        >
                          {c.cell(o, t)}
                        </TableCell>
                      ))}
                      <TableCell className="align-top" onClick={(e) => e.stopPropagation()}>
                        <RowMenu
                          order={o}
                          onOpen={() => open(o)}
                          onApprove={
                            canAdd && o.createdByKind === 'bot' && o.reviewState === 'pending'
                              ? () => approve(o)
                              : undefined
                          }
                        />
                      </TableCell>
                    </TableRow>
                  ))}
              {(data && !rows.length) || unavailable ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={colCount} className="py-16 text-center text-muted-foreground">
                    <PackageOpen className="mx-auto mb-3 size-8 text-primary" aria-hidden />
                    {unavailable
                      ? t('orders.unavailable')
                      : data?.counts['all']
                        ? t('orders.empty')
                        : t('orders.emptyStart')}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
            {data?.total ? (
              <TableFooter className="bg-muted/40">
                <TableRow className="hover:bg-transparent">
                  <TableCell />
                  {columns.map((c, i) => (
                    <TableCell
                      key={c.id}
                      className={cn(
                        'font-medium',
                        c.align === 'right' && 'text-right tabular-nums',
                      )}
                    >
                      {i === 0 ? t('orders.footer.label') : footerCell(c, data.totals)}
                    </TableCell>
                  ))}
                  <TableCell />
                </TableRow>
              </TableFooter>
            ) : null}
          </Table>
        </div>
      </div>

      {data?.total ? (
        <Pager page={page} pageSize={pageSize} total={data.total} onChange={change} />
      ) : null}
    </section>
  );
}
