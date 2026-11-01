import {
  ORDER_CREATOR_BOT_APPROVED,
  ORDER_CREATOR_BOT_PENDING,
  type OrderListQuery,
  OrderSort,
  OrderSource,
  OrderStatus,
} from '@agent-sales/contracts';
import { z } from 'zod';

/** Per-column "contains" searches (one URL parameter each, same name as the API's). */
export const ORDER_TEXT_FILTERS = [
  'code',
  'tracking',
  'customer',
  'phone',
  'address',
  'product',
  'note',
] as const;
export type OrderTextFilter = (typeof ORDER_TEXT_FILTERS)[number];

/** Money columns with a `<column>Min` / `<column>Max` range. */
export const ORDER_MONEY_FILTERS = [
  'total',
  'cod',
  'subtotal',
  'shipping',
  'gross',
  'paid',
] as const;
export type OrderMoneyFilter = (typeof ORDER_MONEY_FILTERS)[number];
export type MoneyBoundKey = `${OrderMoneyFilter}Min` | `${OrderMoneyFilter}Max`;

/** Checklist columns whose values travel as one comma-separated parameter. */
export type OrderListFilter = 'source' | 'carrier' | 'creator';

/** List state kept in the URL (shareable, survives back/forward). */
export type OrdersSearch = {
  status?: OrderStatus[] | undefined;
  /** `exclude`: every status except the chosen ones. */
  statusMode?: 'include' | 'exclude' | undefined;
  /** Staff user ids, `bot_pending`, `bot_approved`. */
  creator?: string[] | undefined;
  carrier?: string[] | undefined;
  source?: OrderSource[] | undefined;
  /** The global search box. */
  q?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
  /** `<column>_<asc|desc>`; unset means the default, newest first (`placed_desc`). */
  sort?: OrderSort | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
} & { [K in OrderTextFilter]?: string | undefined } & {
  [K in MoneyBoundKey]?: number | undefined;
};

export const DEFAULT_ORDER_SORT: OrderSort = 'placed_desc';
export const CREATOR_BOT_TOKENS = [ORDER_CREATOR_BOT_PENDING, ORDER_CREATOR_BOT_APPROVED] as const;

/** One value (older links, `?status=confirmed`) or several. */
const oneOrMany = <T extends z.ZodType>(item: T, max: number) =>
  z
    .union([item.transform((v) => [v]), z.array(item).max(max)])
    .optional()
    .catch(undefined);

const text = z.string().trim().min(1).max(100).optional().catch(undefined);
const money = z.coerce.number().int().min(0).max(1_000_000_000_000).optional().catch(undefined);
const creatorToken = z.union([
  z.uuid(),
  z.literal(ORDER_CREATOR_BOT_PENDING),
  z.literal(ORDER_CREATOR_BOT_APPROVED),
]);

/** Filters live in the URL; anything malformed falls back to "no filter". */
const SearchSchema = z.object({
  status: oneOrMany(OrderStatus, 20),
  statusMode: z.enum(['include', 'exclude']).optional().catch(undefined),
  creator: oneOrMany(creatorToken, 100),
  /** @deprecated Old links: one staff user id. Read as `creator`. */
  createdBy: z.uuid().optional().catch(undefined),
  /** @deprecated Old links: the "Bot · chờ duyệt" quick filter. Read as `creator=bot_pending`. */
  review: z.enum(['pending']).optional().catch(undefined),
  carrier: oneOrMany(z.string().trim().min(1).max(60), 100),
  source: oneOrMany(OrderSource, OrderSource.options.length),
  q: z.string().max(100).optional().catch(undefined),
  ...Object.fromEntries(ORDER_TEXT_FILTERS.map((k) => [k, text])),
  ...Object.fromEntries(
    ORDER_MONEY_FILTERS.flatMap((k) => [
      [`${k}Min`, money],
      [`${k}Max`, money],
    ]),
  ),
  from: z.iso.date().optional().catch(undefined),
  to: z.iso.date().optional().catch(undefined),
  sort: OrderSort.optional().catch(undefined),
  page: z.coerce.number().int().min(1).optional().catch(undefined),
  pageSize: z.coerce
    .number()
    .int()
    .pipe(z.union([z.literal(20), z.literal(50), z.literal(100)]))
    .optional()
    .catch(undefined),
});

/** Drops unset keys so the URL only carries what is filtered. */
function compact<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * The route's `validateSearch`: reads the URL, mapping old parameters (`review=pending`,
 * `createdBy=<id>`, a single `source`) to the column filters.
 */
export function parseOrdersSearch(raw: Record<string, unknown>): OrdersSearch {
  const { createdBy, review, creator, ...rest } = SearchSchema.parse(raw) as OrdersSearch & {
    createdBy?: string;
    review?: 'pending';
  };
  const merged = [
    ...(creator ?? []),
    ...(review === 'pending' ? [ORDER_CREATOR_BOT_PENDING] : []),
    ...(createdBy ? [createdBy] : []),
  ];
  return compact({ ...rest, creator: merged.length ? [...new Set(merged)] : undefined });
}

/** The API query for a list state: lists travel as one comma-separated parameter each. */
export function toOrderQuery({
  status,
  statusMode,
  creator,
  carrier,
  source,
  ...rest
}: OrdersSearch): OrderListQuery {
  const csv = (list: readonly string[] | undefined) => (list?.length ? list.join(',') : undefined);
  return compact({
    ...(status?.length ? { status: status.join(','), statusMode: statusMode ?? 'include' } : {}),
    creator: csv(creator),
    carrier: csv(carrier),
    source: csv(source),
    ...rest,
  }) as OrderListQuery;
}
