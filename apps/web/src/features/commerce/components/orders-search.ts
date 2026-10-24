import type { OrderSource, OrderStatus } from '@agent-sales/contracts';

/** List state kept in the URL (shareable, survives back/forward). */
export interface OrdersSearch {
  status?: OrderStatus | undefined;
  q?: string | undefined;
  source?: OrderSource | undefined;
  from?: string | undefined;
  to?: string | undefined;
  sort?: 'placed_desc' | 'placed_asc' | 'total_desc' | 'total_asc' | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
}
