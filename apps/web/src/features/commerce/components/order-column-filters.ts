import {
  ORDER_CREATOR_BOT_APPROVED,
  ORDER_CREATOR_BOT_PENDING,
  type OrderListResponse,
  type OrderSortColumn,
  OrderSource,
  type OrderStatus,
} from '@agent-sales/contracts';
import type { TFunction } from 'i18next';

import { presetRange } from '@/components/date-range-picker';
import { formatDate, formatNumber } from '@/lib/format';

import {
  DEFAULT_ORDER_SORT,
  type MoneyBoundKey,
  type OrderListFilter,
  type OrderMoneyFilter,
  type OrdersSearch,
  type OrderTextFilter,
} from './orders-search';

/** What a column's header menu filters on. */
export type ColumnFilter =
  | { kind: 'text'; param: OrderTextFilter }
  | { kind: 'list'; param: OrderListFilter; searchable: boolean }
  | { kind: 'money'; param: OrderMoneyFilter }
  | { kind: 'date' }
  | { kind: 'status' };

export interface ColumnMenuSpec {
  /** The column id in `ORDER_COLUMNS`. */
  id: string;
  /** i18n key of the header. */
  header: string;
  sort?: OrderSortColumn;
  filter: ColumnFilter;
}

/** Values the checklists and chips need beyond the URL state. */
export interface OrderFilterContext {
  statuses: readonly OrderStatus[];
  /** Per status (and `all`), from the list response. */
  statusCounts: Record<string, number>;
  facets: OrderListResponse['facets'] | undefined;
  /** Bot orders waiting for review, independent of the filters. */
  pendingReview: number;
}

const text = (id: string, header: string, param: OrderTextFilter, sort?: OrderSortColumn) => ({
  id,
  header,
  filter: { kind: 'text', param } as const,
  ...(sort ? { sort } : {}),
});
const money = (id: OrderMoneyFilter): ColumnMenuSpec => ({
  id,
  header: `orders.col.${id}`,
  sort: id,
  filter: { kind: 'money', param: id },
});

/** Every column's menu (docs/superpowers/specs/2026-10-31-orders-excel-columns-design.md). */
export const ORDER_COLUMN_MENUS: readonly ColumnMenuSpec[] = [
  text('code', 'orders.col.code', 'code', 'code'),
  text('tracking', 'orders.col.tracking', 'tracking'),
  text('customer', 'orders.col.customer', 'customer', 'customer'),
  text('phone', 'orders.col.phone', 'phone'),
  text('address', 'orders.col.address', 'address'),
  text('products', 'orders.col.products', 'product'),
  {
    id: 'carrier',
    header: 'orders.col.carrier',
    sort: 'carrier',
    filter: { kind: 'list', param: 'carrier', searchable: true },
  },
  money('subtotal'),
  money('shipping'),
  money('gross'),
  money('total'),
  money('paid'),
  money('cod'),
  text('note', 'orders.col.note', 'note'),
  {
    id: 'source',
    header: 'orders.col.source',
    sort: 'source',
    filter: { kind: 'list', param: 'source', searchable: false },
  },
  {
    id: 'creator',
    header: 'orders.col.createdBy',
    sort: 'creator',
    filter: { kind: 'list', param: 'creator', searchable: true },
  },
  { id: 'placedAt', header: 'orders.col.placedAt', sort: 'placed', filter: { kind: 'date' } },
  { id: 'status', header: 'orders.col.status', sort: 'status', filter: { kind: 'status' } },
];

export const columnMenu = (id: string) => ORDER_COLUMN_MENUS.find((m) => m.id === id);

const bounds = (p: OrderMoneyFilter) => [`${p}Min`, `${p}Max`] as [MoneyBoundKey, MoneyBoundKey];

/** The URL keys a column's filter owns, all unset: its "Xoá lọc cột". */
export function clearColumn(spec: ColumnMenuSpec): Partial<OrdersSearch> {
  const f = spec.filter;
  switch (f.kind) {
    case 'text':
    case 'list':
      return { [f.param]: undefined };
    case 'money': {
      const [min, max] = bounds(f.param);
      return { [min]: undefined, [max]: undefined };
    }
    case 'date':
      return { from: undefined, to: undefined };
    case 'status':
      return { status: undefined, statusMode: undefined };
  }
}

export function isColumnFiltered(spec: ColumnMenuSpec, s: OrdersSearch): boolean {
  const f = spec.filter;
  switch (f.kind) {
    case 'text':
      return Boolean(s[f.param]);
    case 'list':
      return Boolean(s[f.param]?.length);
    case 'money': {
      const [min, max] = bounds(f.param);
      return s[min] !== undefined || s[max] !== undefined;
    }
    case 'date':
      return Boolean(s.from && s.to);
    case 'status':
      return Boolean(s.status?.length);
  }
}

/** `asc` / `desc` when the list is sorted by this column (unset sort = newest first). */
export function columnSortDir(spec: ColumnMenuSpec, s: OrdersSearch): 'asc' | 'desc' | null {
  const [col, dir] = (s.sort ?? DEFAULT_ORDER_SORT).split('_') as [string, 'asc' | 'desc'];
  return spec.sort && col === spec.sort ? dir : null;
}

/** One checklist entry. */
export interface ListOption {
  value: string;
  label: string;
}

/** The choices of a checklist column, in display order. */
export function listOptions(
  param: OrderListFilter,
  t: TFunction,
  ctx: OrderFilterContext,
  chosen: readonly string[] = [],
): ListOption[] {
  let options: ListOption[];
  if (param === 'source') {
    options = OrderSource.options.map((s) => ({ value: s, label: t(`source.${s}`) }));
  } else if (param === 'carrier') {
    options = (ctx.facets?.carriers ?? []).map((c) => ({ value: c, label: c }));
  } else {
    options = [
      { value: ORDER_CREATOR_BOT_PENDING, label: t('orders.columnMenu.botPending') },
      { value: ORDER_CREATOR_BOT_APPROVED, label: t('orders.columnMenu.botApproved') },
      ...(ctx.facets?.creators ?? []).map((c) => ({ value: c.id, label: c.name })),
    ];
  }
  // A value from the URL the facets do not list (yet) stays visible so it can be unticked.
  const known = new Set(options.map((o) => o.value));
  const extra = chosen
    .filter((v) => !known.has(v))
    .map((v) => ({ value: v, label: param === 'carrier' ? v : '…' }));
  return [...options, ...extra];
}

/** Excel-style counts for a checklist; `undefined` when the API did not send them. */
export function listCounts(
  param: OrderListFilter,
  ctx: OrderFilterContext,
): Record<string, number> | undefined {
  return ctx.facets?.counts?.[param];
}

const CHIP_PRESETS = ['today', 'last7', 'last30', 'monthToDate'] as const;
export const DATE_PRESETS = CHIP_PRESETS;

const vnd = (n: number) => `${formatNumber(n)} ₫`;

/** The readable value of a column's active filter ("Bot · chờ duyệt", "100.000–500.000 ₫"). */
export function filterValueLabel(
  spec: ColumnMenuSpec,
  s: OrdersSearch,
  t: TFunction,
  ctx: OrderFilterContext,
): string {
  const f = spec.filter;
  switch (f.kind) {
    case 'text':
      return `“${s[f.param] ?? ''}”`;
    case 'list': {
      const chosen = s[f.param] ?? [];
      const labels = new Map(listOptions(f.param, t, ctx, chosen).map((o) => [o.value, o.label]));
      return chosen.map((v) => labels.get(v) ?? v).join(', ');
    }
    case 'money': {
      const [minKey, maxKey] = bounds(f.param);
      const min = s[minKey];
      const max = s[maxKey];
      if (min !== undefined && max !== undefined) return `${formatNumber(min)}–${vnd(max)}`;
      if (min !== undefined) return `≥ ${vnd(min)}`;
      return `≤ ${vnd(max ?? 0)}`;
    }
    case 'date': {
      const preset = CHIP_PRESETS.find((p) => {
        const r = presetRange(p);
        return r.from === s.from && r.to === s.to;
      });
      if (preset) return t(`orders.columnMenu.presets.${preset}`);
      return s.from === s.to
        ? formatDate(s.from ?? '')
        : `${formatDate(s.from ?? '')} – ${formatDate(s.to ?? '')}`;
    }
    case 'status': {
      const names = (s.status ?? []).map((x) => t(`status.${x}`)).join(', ');
      return s.statusMode === 'exclude' ? t('orders.filters.excluding', { name: names }) : names;
    }
  }
}

/** One removable chip per filtered column, hidden columns included. */
export function activeFilterChips(s: OrdersSearch, t: TFunction, ctx: OrderFilterContext) {
  return ORDER_COLUMN_MENUS.filter((m) => isColumnFiltered(m, s)).map((m) => ({
    key: m.id,
    label: `${t(m.header)}: ${filterValueLabel(m, s, t, ctx)}`,
    clear: clearColumn(m),
  }));
}

/** Whether the list is narrowed by the global search or any column filter. */
export function hasAnyFilter(s: OrdersSearch): boolean {
  return Boolean(s.q?.trim()) || ORDER_COLUMN_MENUS.some((m) => isColumnFiltered(m, s));
}

/** Every column filter and the global search unset: "Xoá lọc". */
export function clearAllFilters(): Partial<OrdersSearch> {
  return Object.assign(
    { q: undefined },
    ...ORDER_COLUMN_MENUS.map(clearColumn),
  ) as Partial<OrdersSearch>;
}
