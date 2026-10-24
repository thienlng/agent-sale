import type { MetricKey, Origin } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** Everything that decides which facts a number is computed from. Two calls with equal contexts agree. */
export interface QueryContext {
  workspaceId: WorkspaceId;
  timezone: string;
  /** Half-open UTC interval of the local days asked for. */
  fromUtc: Date;
  toUtc: Date;
  asOf: Date;
  /** Fixes "now" for ownership lookups of the scope. */
  generatedAt: Date;
  /** Only facts of events up to this outbox id (the projection watermark). */
  watermark: number;
  /** A restricted viewer (Sales, CSKH) sees customers they own or nobody owns; null = all. */
  ownOnly: string | null;
  salesIds: readonly string[] | null;
  pageIds: readonly string[] | null;
  /** Effective origins per metric (see `effectiveOrigins`). */
  origins: Partial<Record<MetricKey, readonly Origin[]>>;
}

export type Counts = Partial<Record<MetricKey, number>>;

export interface DrilldownFilter {
  salesUserId?: string | null | undefined;
  tagId?: string | undefined;
  statusId?: string | null | undefined;
  channelId?: string | null | undefined;
  /** Local day. */
  date?: string | undefined;
}

export interface UnitRow {
  at: Date;
  contactId: string | null;
  conversationId: string | null;
  channelId: string | null;
  subjectId: string | null;
  salesUserId: string | null;
}

export interface ReadStore {
  /** One number per base (non-derived) metric. Distinct per the metric's definition across the whole range. */
  totals(ctx: QueryContext, metrics: readonly MetricKey[]): Promise<Counts>;
  /** Event metrics per local day (days with nothing are absent). */
  series(
    ctx: QueryContext,
    metrics: readonly MetricKey[],
  ): Promise<Array<{ day: string; metric: MetricKey; value: number }>>;
  tagEvents(
    ctx: QueryContext,
  ): Promise<Array<{ tagId: string; assigned: number; removed: number }>>;
  currentTags(ctx: QueryContext): Promise<Array<{ tagId: string; count: number }>>;
  statuses(ctx: QueryContext): Promise<Array<{ statusId: string | null; count: number }>>;
  bySales(
    ctx: QueryContext,
    metrics: readonly MetricKey[],
  ): Promise<Array<{ salesUserId: string | null; metric: MetricKey; value: number }>>;
  byPage(
    ctx: QueryContext,
    metrics: readonly MetricKey[],
  ): Promise<Array<{ channelId: string | null; metric: MetricKey; value: number }>>;
  drilldown(
    ctx: QueryContext,
    metric: MetricKey,
    filter: DrilldownFilter,
    page: { cursor: { at: Date; unitId: number } | null; limit: number },
  ): Promise<{ total: number; rows: Array<UnitRow & { unitId: number }> }>;
}
export const READ_STORE = Symbol('READ_STORE');
