import {
  ANALYTICS_DEFINITION_VERSION,
  type AnalyticsQuery,
  type AnalyticsResponse,
  definitionOf,
  type DrilldownRequest,
  type DrilldownResponse,
  effectiveOrigins,
  lockedMetrics,
  type MetricKey,
  type MetricResult,
  type QueryIssue,
  roleCan,
  validateAnalyticsQuery,
} from '@agent-sales/contracts';
import { datesBetween, nextDate, startOfLocalDay, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { BILLING_FACADE, type BillingFacade } from '../../billing/api/index.js';
import { CRM_FACADE, type CrmFacade } from '../../crm/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import { InvalidAnalyticsQueryError } from '../domain/analytics.errors.js';
import { READ_STORE, type QueryContext, type ReadStore } from '../domain/ports/read.js';
import { ProjectorService } from './projector.service.js';

export interface Viewer {
  userId: string;
  role: string | undefined;
}

const SALES_ATTRIBUTED = (m: MetricKey) => definitionOf(m).filters.sales;
const PAGE_ATTRIBUTED = (m: MetricKey) => definitionOf(m).filters.page;

/**
 * Statistics queries: validates against the definitions, catches the projection up, then computes
 * every number from the same facts at one watermark. Never answers 0 for something it could not compute.
 */
@Injectable()
export class QueryService {
  constructor(
    @Inject(READ_STORE) private readonly store: ReadStore,
    @Inject(ProjectorService) private readonly projector: ProjectorService,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
    @Inject(BILLING_FACADE) private readonly billing: BillingFacade,
    @Inject(CRM_FACADE) private readonly crm: CrmFacade,
  ) {}

  async query(ws: WorkspaceId, q: AnalyticsQuery, viewer: Viewer): Promise<AnalyticsResponse> {
    this.#validate(q);
    const { ctx, meta, locked } = await this.#prepare(ws, q, viewer);
    const open = q.metrics.filter((m) => !locked.includes(m));
    const base = new Set<MetricKey>();
    for (const m of open) {
      for (const dep of definitionOf(m).kind === 'derived' ? definitionOf(m).derivedFrom : [m]) {
        base.add(dep);
      }
    }
    const events = [...base].filter((m) => definitionOf(m).kind === 'event');
    const wants = (m: MetricKey) => open.includes(m);
    const tagsAsked = wants('tags.assigned') || wants('tags.removed') || wants('tags.net');

    const [totals, series, tags, currentTags, statuses, bySales, byPage] = await Promise.all([
      this.store.totals(ctx, [...base]),
      this.store.series(ctx, events),
      tagsAsked ? this.store.tagEvents(ctx) : [],
      wants('tags.current') ? this.store.currentTags(ctx) : [],
      wants('statuses.current') ? this.store.statuses(ctx) : [],
      this.store.bySales(ctx, events.filter(SALES_ATTRIBUTED)),
      this.store.byPage(ctx, events.filter(PAGE_ATTRIBUTED)),
    ]);

    const valueOf = (counts: Partial<Record<MetricKey, number>>, m: MetricKey): number => {
      const d = definitionOf(m);
      if (d.kind !== 'derived') return counts[m] ?? 0;
      return (
        (counts[d.derivedFrom[0] as MetricKey] ?? 0) - (counts[d.derivedFrom[1] as MetricKey] ?? 0)
      );
    };
    const withDerived = (counts: Partial<Record<MetricKey, number>>) => {
      const out = { ...counts };
      for (const m of open) if (definitionOf(m).kind === 'derived') out[m] = valueOf(counts, m);
      return out;
    };

    const cards: MetricResult[] = q.metrics.map((key) =>
      locked.includes(key)
        ? { key, state: 'locked' }
        : { key, state: 'ok', value: valueOf(totals, key) },
    );

    const dayValues = new Map<string, Partial<Record<MetricKey, number>>>();
    for (const r of series) {
      dayValues.set(r.day, { ...dayValues.get(r.day), [r.metric]: r.value });
    }
    const eventMetrics = open.filter((m) => definitionOf(m).kind !== 'snapshot');
    const days = datesBetween(q.dateRange.from, q.dateRange.to).map((date) => {
      const raw = dayValues.get(date) ?? {};
      const withNet = withDerived(raw);
      return {
        date,
        values: Object.fromEntries(eventMetrics.map((m) => [m, withNet[m] ?? 0])),
      };
    });

    const group = <K extends 'salesUserId' | 'channelId'>(
      rows: Array<{ metric: MetricKey; value: number } & Record<K, string | null>>,
      key: K,
    ) => {
      const map = new Map<string | null, Partial<Record<MetricKey, number>>>();
      for (const r of rows) map.set(r[key], { ...map.get(r[key]), [r.metric]: r.value });
      return [...map.entries()].map(([id, values]) => ({ id, values: withDerived(values) }));
    };

    // A customer with two tags sits in two tag rows: the total is distinct customers, not their sum.
    const distinctTotals = Object.fromEntries(
      open.filter((m) => !definitionOf(m).additiveAcrossBreakdown).map((m) => [m, totals[m] ?? 0]),
    );

    return {
      meta,
      cards,
      series: days,
      breakdowns: {
        tags: tags.map((t) => ({ ...t, net: t.assigned - t.removed })),
        currentTags,
        statuses,
        bySales: group(bySales, 'salesUserId').map(({ id, values }) => ({
          salesUserId: id,
          values,
        })),
        byPage: group(byPage, 'channelId').map(({ id, values }) => ({ channelId: id, values })),
      },
      distinctTotals,
    };
  }

  async drilldown(
    ws: WorkspaceId,
    req: DrilldownRequest & { limit: number },
    viewer: Viewer,
  ): Promise<DrilldownResponse> {
    const q = { ...req.query, metrics: [req.metric] };
    this.#validate(q);
    const d = definitionOf(req.metric);
    const dim = req.dimension ?? {};
    const issues: QueryIssue[] = [];
    if (d.kind === 'derived') issues.push({ code: 'not_drillable', metric: req.metric });
    const asks = (filter: string, allowed: boolean, present: boolean) => {
      if (present && !allowed) {
        issues.push({ code: 'scope_not_supported', metric: req.metric, detail: { filter } });
      }
    };
    asks('tag', d.group === 'tags', dim.tagId !== undefined);
    asks('status', d.group === 'statuses', dim.statusId !== undefined);
    asks('page', d.filters.page, dim.channelId !== undefined);
    asks('sales', d.filters.sales, dim.salesUserId !== undefined);
    asks('date', d.kind === 'event', dim.date !== undefined);
    if (issues.length) throw new InvalidAnalyticsQueryError(issues);

    const { ctx, meta, locked } = await this.#prepare(ws, q, viewer);
    if (locked.length)
      throw new InvalidAnalyticsQueryError([{ code: 'metric_locked', metric: req.metric }]);
    const cursor = decodeCursor(req.cursor);
    const found = await this.store.drilldown(ctx, req.metric, dim, { cursor, limit: req.limit });
    const page = found.rows.slice(0, req.limit);
    const names = await this.crm.contactNames(
      ws,
      page.flatMap((r) => (r.contactId ? [r.contactId] : [])),
    );
    const last = page[page.length - 1];
    return {
      meta,
      metric: req.metric,
      total: found.total,
      rows: page.map((r) => ({
        at: r.at.toISOString(),
        contactId: r.contactId,
        contactName: r.contactId ? (names.get(r.contactId) ?? null) : null,
        conversationId: r.conversationId,
        channelId: r.channelId,
        tagId: d.group === 'tags' ? r.subjectId : null,
        statusId: d.group === 'statuses' ? r.subjectId : null,
        salesUserId: r.salesUserId,
      })),
      nextCursor:
        found.rows.length > req.limit && last ? `${last.at.toISOString()}|${last.unitId}` : null,
    };
  }

  #validate(q: AnalyticsQuery): void {
    const issues = validateAnalyticsQuery(q, new Date());
    if (issues.length) throw new InvalidAnalyticsQueryError(issues);
  }

  async #prepare(ws: WorkspaceId, q: AnalyticsQuery, viewer: Viewer) {
    const [workspace, entitlements] = await Promise.all([
      this.workspaces.getById(ws),
      this.billing.entitlements(ws),
    ]);
    const timezone = workspace.timezone;
    // Read-your-writes without a worker: consume what is pending before answering.
    await this.projector.catchUp();
    const health = await this.projector.health();
    const watermark = q.watermark ?? health.watermarkId;
    const now = new Date();
    const fromUtc = startOfLocalDay(q.dateRange.from, timezone);
    const toUtc = startOfLocalDay(nextDate(q.dateRange.to), timezone);
    const ownOnly = roleCan(viewer.role, 'contacts.view_all') ? null : viewer.userId;
    const ctx: QueryContext = {
      workspaceId: ws,
      timezone,
      fromUtc,
      toUtc,
      asOf: q.asOf ? new Date(q.asOf) : now,
      generatedAt: now,
      watermark,
      ownOnly,
      salesIds: q.salesIds?.length ? q.salesIds : null,
      pageIds: q.pageIds?.length ? q.pageIds : null,
      origins: Object.fromEntries(
        q.metrics.map((m) => [m, effectiveOrigins(definitionOf(m), q.origins)]),
      ),
    };
    return {
      ctx,
      locked: lockedMetrics(q.metrics, entitlements.features),
      meta: {
        definitionVersion: ANALYTICS_DEFINITION_VERSION,
        timezone,
        range: {
          from: q.dateRange.from,
          to: q.dateRange.to,
          fromUtc: fromUtc.toISOString(),
          toUtc: toUtc.toISOString(),
        },
        asOf: ctx.asOf.toISOString(),
        generatedAt: now.toISOString(),
        watermarkId: watermark,
        watermarkAt: health.watermarkAt?.toISOString() ?? null,
        lagSeconds: health.lagSeconds,
        scope: ownOnly ? ('own' as const) : ('all' as const),
      },
    };
  }
}

function decodeCursor(raw: string | undefined): { at: Date; unitId: number } | null {
  if (!raw) return null;
  const [at, id] = raw.split('|');
  const unitId = Number(id);
  const when = at ? new Date(at) : null;
  if (!when || Number.isNaN(when.getTime()) || !Number.isInteger(unitId)) {
    throw new InvalidAnalyticsQueryError([
      { code: 'range_invalid', detail: { cursor: 'invalid' } },
    ]);
  }
  return { at: when, unitId };
}
