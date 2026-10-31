import {
  ORDER_CREATOR_BOT_PENDING,
  ORDER_MONEY_COLUMNS,
  type OrderListQuery as OrderListSchema,
} from '@agent-sales/contracts';
import { foldVietnamese } from '@agent-sales/shared';
import type { z } from 'zod';

import type { OrderListFilter, OrderListText } from './ports/commerce-store.js';

type ListQuery = z.output<typeof OrderListSchema>;

/**
 * Digit sequences a phone search matches: the typed digits, plus the same number with the
 * other country prefix (`0…` ↔ `84…`), so `0901` finds `+84 901…` and the reverse.
 */
export function phoneNeedles(query: string): string[] {
  const digits = query.replace(/\D/g, '');
  if (!digits) return [];
  if (digits.startsWith('0') && digits.length > 1) return [digits, `84${digits.slice(1)}`];
  if (digits.startsWith('84') && digits.length > 2) return [digits, `0${digits.slice(2)}`];
  return [digits];
}

/** The deprecated `createdBy` and `review=pending` join the `creator` list. */
function creatorsOf(q: ListQuery): string[] | undefined {
  const all = new Set(q.creator ?? []);
  if (q.createdBy) all.add(q.createdBy);
  if (q.review === 'pending') all.add(ORDER_CREATOR_BOT_PENDING);
  return all.size ? [...all] : undefined;
}

const fold = (s: string | undefined) => (s === undefined ? undefined : foldVietnamese(s));

/** Maps the parsed `GET /orders` query to the store filter (dates already in UTC). */
export function toOrderListFilter(
  q: ListQuery,
  range: { from?: Date | undefined; to?: Date | undefined },
): OrderListFilter {
  const text: OrderListText = {
    code: fold(q.code),
    tracking: fold(q.tracking),
    customer: fold(q.customer),
    phone: q.phone === undefined ? undefined : phoneNeedles(q.phone),
    address: fold(q.address),
    product: fold(q.product),
    note: fold(q.note),
  };
  const money: OrderListFilter['money'] = {};
  for (const col of ORDER_MONEY_COLUMNS) {
    const min = q[`${col}Min`];
    const max = q[`${col}Max`];
    if (min !== undefined || max !== undefined) money[col] = { min, max };
  }
  return {
    statuses: q.status,
    statusMode: q.statusMode,
    creators: creatorsOf(q),
    carriers: q.carrier?.length ? q.carrier : undefined,
    sources: q.source?.length ? q.source : undefined,
    q: q.q ? foldVietnamese(q.q) : undefined,
    text,
    money,
    from: range.from,
    to: range.to,
    sort: q.sort,
    offset: (q.page - 1) * q.pageSize,
    limit: q.pageSize,
  };
}
