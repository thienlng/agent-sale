import {
  ORDER_CREATOR_BOT_APPROVED,
  ORDER_CREATOR_BOT_PENDING,
  type OrderSort,
} from '@agent-sales/contracts';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from '@agent-sales/db';

import type { OrderListFilter, OrderMoneyColumn } from '../../application/ports/commerce-store.js';
import { contains, n, o, oi } from './commerce.rows.js';

/** SQL pieces of the orders list: filters by column, sort keys and facet keys. */

/** Bot orders waiting for review; cancelling one rejects it (partial index orders_review_pending_idx). */
export const pendingReview = and(eq(o.reviewState, 'pending'), notInArray(o.status, ['cancelled']));

/** What the customer owes before the discount (the list's gross column and footer). */
export const grossExpr = sql<number>`(${o.subtotal} + ${o.shippingFeeCharged} + ${o.surcharge})`;

/** The creator filter's value for an order: a staff user id, `bot_pending` or `bot_approved`. */
export const creatorKey = sql<string | null>`case when ${o.createdByKind} = 'bot' then (case
  when ${o.reviewState} = 'approved' then ${sql.raw(`'${ORDER_CREATOR_BOT_APPROVED}'`)}
  when ${o.reviewState} = 'pending' and ${o.status} <> 'cancelled' then ${sql.raw(`'${ORDER_CREATOR_BOT_PENDING}'`)}
  end) else ${o.createdByUserId}::text end`;

const MONEY_EXPR: Record<OrderMoneyColumn, SQL> = {
  total: sql`${o.total}`,
  cod: sql`${o.codAmount}`,
  subtotal: sql`${o.subtotal}`,
  shipping: sql`${o.shippingFeeCharged}`,
  gross: grossExpr,
  paid: sql`${o.paid}`,
};

/** Text folded like `foldVietnamese`: unaccent (đ → d too), lower case, single spaces. */
const folded = (expr: unknown) =>
  sql`regexp_replace(lower(unaccent(coalesce(${expr}, ''))), '\\s+', ' ', 'g')`;
const foldedContains = (expr: unknown, q: string) => contains(folded(expr), q);
const digitsOf = (expr: unknown) => sql`regexp_replace(coalesce(${expr}, ''), '\\D', '', 'g')`;

/** Sort keys per column; ties fall back to placed time descending, then code. */
const SORT_KEY: Record<string, SQL> = {
  code: sql`${o.code}`,
  customer: sql`lower(${o.customer} ->> 'name')`,
  total: sql`${o.total}`,
  cod: sql`${o.codAmount}`,
  subtotal: sql`${o.subtotal}`,
  shipping: sql`${o.shippingFeeCharged}`,
  gross: grossExpr,
  paid: sql`${o.paid}`,
  source: sql`${o.source}`,
  // Bots sort by the bot's name (kept in created_by_name).
  creator: sql`coalesce(${o.createdByName}, '')`,
  status: sql`${o.status}`,
};

export function orderBy(sort: OrderSort): SQL[] {
  const cut = sort.lastIndexOf('_');
  const column = sort.slice(0, cut);
  const dir = sort.slice(cut + 1) === 'asc' ? asc : desc;
  // Kept as before: oldest first, then code ascending.
  if (sort === 'placed_asc') return [asc(o.placedAt), asc(o.code)];
  const ties = [desc(o.placedAt), desc(o.code)];
  if (column === 'placed') return ties;
  if (column === 'carrier')
    return [sql`${o.carrier} ${sql.raw(dir === asc ? 'asc' : 'desc')} nulls last`, ...ties];
  const key = SORT_KEY[column];
  return key ? [dir(key), ...ties] : ties;
}

export const countsByKey = (rows: Array<{ key: string | null; c: number }>) =>
  Object.fromEntries(rows.flatMap((r) => (r.key === null ? [] : [[r.key, n(r.c)]])));

/** The list's filters by name; `undefined` when not given. */
export function listFilterParts(f: OrderListFilter) {
  const t = f.text;
  const creators = f.creators ?? [];
  const userIds = creators.filter(
    (c) => c !== ORDER_CREATOR_BOT_PENDING && c !== ORDER_CREATOR_BOT_APPROVED,
  );
  const either = (a: unknown, b: unknown, q: string) =>
    or(foldedContains(a, q), foldedContains(b, q));
  return {
    status: f.statuses?.length
      ? f.statusMode === 'exclude'
        ? notInArray(o.status, f.statuses)
        : inArray(o.status, f.statuses)
      : undefined,
    q: f.q ? contains(o.searchText, f.q) : undefined,
    source: f.sources?.length ? inArray(o.source, f.sources) : undefined,
    carrier: f.carriers?.length ? inArray(o.carrier, f.carriers) : undefined,
    creator: creators.length
      ? or(
          userIds.length ? inArray(o.createdByUserId, userIds) : undefined,
          creators.includes(ORDER_CREATOR_BOT_PENDING) ? pendingReview : undefined,
          creators.includes(ORDER_CREATOR_BOT_APPROVED) ? eq(o.reviewState, 'approved') : undefined,
        )
      : undefined,
    from: f.from ? sql`${o.placedAt} >= ${f.from.toISOString()}` : undefined,
    to: f.to ? sql`${o.placedAt} < ${f.to.toISOString()}` : undefined,
    code: t.code ? foldedContains(o.code, t.code) : undefined,
    tracking: t.tracking ? foldedContains(o.trackingCode, t.tracking) : undefined,
    customer: t.customer
      ? either(sql`${o.customer} ->> 'name'`, sql`${o.recipient} ->> 'name'`, t.customer)
      : undefined,
    phone: t.phone
      ? t.phone.length
        ? or(
            ...t.phone.flatMap((d) => [
              contains(digitsOf(sql`${o.customer} ->> 'phone'`), d),
              contains(digitsOf(sql`${o.recipient} ->> 'phone'`), d),
            ]),
          )
        : sql`false`
      : undefined,
    address: t.address
      ? foldedContains(
          sql`concat_ws(', ', ${o.recipient} ->> 'address', ${o.recipient} ->> 'ward', ${o.recipient} ->> 'province')`,
          t.address,
        )
      : undefined,
    product: t.product
      ? sql`exists (select 1 from ${oi} where ${oi.orderId} = ${o.id} and ${either(
          oi.productName,
          oi.variantName,
          t.product,
        )})`
      : undefined,
    note: t.note ? either(o.noteInternal, o.notePrint, t.note) : undefined,
    ...Object.fromEntries(
      Object.entries(f.money).map(([col, r]) => [
        `money_${col}`,
        and(
          r?.min !== undefined ? gte(MONEY_EXPR[col as OrderMoneyColumn], r.min) : undefined,
          r?.max !== undefined ? lte(MONEY_EXPR[col as OrderMoneyColumn], r.max) : undefined,
        ),
      ]),
    ),
  };
}
