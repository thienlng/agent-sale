import { z } from 'zod';

import { Money } from './commerce.schema.js';

// ─── Overview (ORD-11) ────────────────────────────────────────────────────────

/** At most 366 days: the daily series and the KPIs summed from it cover the whole range. */
export const OrderOverviewQuery = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((r) => Math.abs(Date.parse(r.to) - Date.parse(r.from)) <= 365 * 86_400_000, {
    message: 'the range can be at most 366 days',
    path: ['to'],
  });

const Kpis = z.object({
  /** "Doanh số": Σ total of every order except cancelled ones. */
  sales: Money,
  /** "Doanh thu": Σ total of closed orders. */
  revenue: Money,
  /** Σ over closed orders of (goods − cost − discount − shipping the shop absorbed); may be negative. */
  profit: z.number().int(),
  closedOrders: z.number().int(),
  avgOrderValue: Money,
  productQty: z.number().int(),
  avgProductsPerOrder: z.number(),
  avgProfitPerOrder: z.number().int(),
});

export const OrderOverviewResponse = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  timezone: z.string(),
  kpis: Kpis,
  closed: z.object({ amount: Money, productQty: z.number().int() }),
  returned: z.object({ amount: Money, productQty: z.number().int() }),
  series: z.array(
    z.object({
      date: z.iso.date(),
      sales: Money,
      revenue: Money,
      profit: z.number().int(),
      closedOrders: z.number().int(),
      productQty: z.number().int(),
    }),
  ),
  today: z.object({
    revenue: Money,
    closedOrders: z.number().int(),
    created: z.number().int(),
    cancelled: z.number().int(),
    productQty: z.number().int(),
    byHour: z.array(z.object({ hour: z.number().int(), revenue: Money })),
  }),
  generatedAt: z.iso.datetime(),
});
export type OrderOverviewResponse = z.infer<typeof OrderOverviewResponse>;
