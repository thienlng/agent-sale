/**
 * Where scheduled reports read their figures (S3-R1): the `commerce`, `conversation`, `crm`,
 * `lodging` and `workspace` facades behind one port, so the report service is testable with a fake. Every method reads
 * one business; none returns customer data. `ids` only feed an alert's fingerprint and are
 * never stored or delivered.
 */
export interface RevenueFigures {
  sales: number;
  revenue: number;
  closedOrders: number;
  averageOrderValue: number;
  profit: number;
}

export interface OrderFigures {
  count: number;
  total: number;
  /** Newest first, at most 5. */
  latest: { code: string; total: number; placedAt: string }[];
}

export interface StockFigures {
  count: number;
  items: { product: string; sku: string | null; available: number }[];
  /** Variant ids of the listed items (alert fingerprint only). */
  ids: string[];
}

export interface AwaitingFigures {
  count: number;
  oldestSince: string | null;
  byChannel: { channel: string; count: number }[];
  ids: string[];
}

export interface ContactFigures {
  count: number;
  bySource: { source: string | null; count: number }[];
}

/** A hotel's stays checking in during the period (S3-R1 via the `lodging` facade). */
export interface StayFigures {
  bookings: number;
  nights: number;
  revenue: number;
  profit: number;
}

export interface ReportDataSource {
  /** The business's industry key (`hotel`, `retail`, …): a hotel's revenue is its stays. */
  industry(ws: string): Promise<string>;
  /** Stays checking in on local dates `from`..`to`, inclusive. */
  stays(ws: string, from: string, to: string): Promise<StayFigures>;
  /** Local dates `from`..`to`, inclusive. */
  revenue(ws: string, from: string, to: string): Promise<RevenueFigures>;
  orders(ws: string, since: Date, until: Date): Promise<OrderFigures>;
  lowStock(ws: string, threshold: number): Promise<StockFigures>;
  awaiting(ws: string, olderThan: Date): Promise<AwaitingFigures>;
  newContacts(ws: string, since: Date, until: Date): Promise<ContactFigures>;
}

export const REPORT_DATA_SOURCE = Symbol('REPORT_DATA_SOURCE');

/** The `notification` catalog of a language as flat keys (loaded by infrastructure, 3-P3). */
export type ReportStringsSource = (locale: 'vi' | 'en') => Record<string, string>;
export const REPORT_STRINGS = Symbol('REPORT_STRINGS');
