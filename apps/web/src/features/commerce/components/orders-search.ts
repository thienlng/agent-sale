import type { OrderListQuery, OrderSource, OrderStatus } from '@agent-sales/contracts';

/** List state kept in the URL (shareable, survives back/forward). */
export interface OrdersSearch {
  status?: OrderStatus[] | undefined;
  /** `exclude`: every status except the chosen ones. */
  statusMode?: 'include' | 'exclude' | undefined;
  createdBy?: string | undefined;
  /** `pending`: only bot orders that wait for review (the toolbar quick filter). */
  review?: 'pending' | undefined;
  carrier?: string | undefined;
  q?: string | undefined;
  source?: OrderSource | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort?: 'placed_desc' | 'placed_asc' | 'total_desc' | 'total_asc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}

/** The API query for a list state: statuses travel as one comma-separated parameter. */
export function toOrderQuery({ status, statusMode, ...rest }: OrdersSearch): OrderListQuery {
  return status?.length
    ? { ...rest, status: status.join(','), statusMode: statusMode ?? 'include' }
    : rest;
}
