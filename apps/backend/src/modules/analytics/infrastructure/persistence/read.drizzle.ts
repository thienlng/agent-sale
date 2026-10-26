import { definitionOf, type MetricKey } from '@agent-sales/contracts';
import { type Database, type SQL, sql, withTenant } from '@agent-sales/db';

import type {
  Counts,
  DrilldownFilter,
  QueryContext,
  ReadStore,
  UnitRow,
} from '../../domain/ports/read.js';
import { countExpr, dimensionWhere, filteredUnits } from './analytics-sql.js';

const num = (v: unknown) => Number(v ?? 0);
const toDate = (v: unknown) => (v instanceof Date ? v : new Date(String(v)));
const iso = (d: unknown) =>
  d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10);

type Rows = Array<Record<string, unknown>>;

/** Reads statistics under tenant RLS: facts of other workspaces are invisible by construction. */
export class DrizzleReadStore implements ReadStore {
  constructor(private readonly db: Database) {}

  #run(ctx: QueryContext, query: SQL): Promise<Rows> {
    return withTenant(
      this.db,
      ctx.workspaceId,
      async (tx) => [...(await tx.execute(query))] as Rows,
    );
  }

  async totals(ctx: QueryContext, metrics: readonly MetricKey[]): Promise<Counts> {
    const out: Counts = {};
    await Promise.all(
      metrics.map(async (m) => {
        const [r] = await this.#run(
          ctx,
          sql`select ${countExpr(m)} as n from ${filteredUnits(ctx, m)} x`,
        );
        out[m] = num(r?.['n']);
      }),
    );
    return out;
  }

  async series(ctx: QueryContext, metrics: readonly MetricKey[]) {
    const rows = await Promise.all(
      metrics.map(async (m) =>
        (
          await this.#run(
            ctx,
            sql`select x.day as day, ${countExpr(m)} as n from ${filteredUnits(ctx, m)} x group by x.day`,
          )
        ).map((r) => ({ day: iso(r['day']), metric: m, value: num(r['n']) })),
      ),
    );
    return rows.flat();
  }

  async tagEvents(ctx: QueryContext) {
    const count = async (m: 'tags.assigned' | 'tags.removed') =>
      this.#run(
        ctx,
        sql`select x.subject_id as tag_id, count(*) as n from ${filteredUnits(ctx, m)} x group by x.subject_id`,
      );
    const [assigned, removed] = await Promise.all([count('tags.assigned'), count('tags.removed')]);
    const byTag = new Map<string, { tagId: string; assigned: number; removed: number }>();
    for (const r of assigned) {
      const id = String(r['tag_id']);
      byTag.set(id, { tagId: id, assigned: num(r['n']), removed: 0 });
    }
    for (const r of removed) {
      const id = String(r['tag_id']);
      byTag.set(id, { tagId: id, assigned: byTag.get(id)?.assigned ?? 0, removed: num(r['n']) });
    }
    return [...byTag.values()].sort(
      (a, b) => b.assigned - a.assigned || a.tagId.localeCompare(b.tagId),
    );
  }

  async currentTags(ctx: QueryContext) {
    const rows = await this.#run(
      ctx,
      sql`select x.subject_id as tag_id, count(*) as n from ${filteredUnits(ctx, 'tags.current')} x
          group by x.subject_id order by n desc, x.subject_id`,
    );
    return rows.map((r) => ({ tagId: String(r['tag_id']), count: num(r['n']) }));
  }

  async statuses(ctx: QueryContext) {
    const rows = await this.#run(
      ctx,
      sql`select x.subject_id as status_id, count(*) as n from ${filteredUnits(ctx, 'statuses.current')} x
          group by x.subject_id order by n desc, x.subject_id nulls last`,
    );
    return rows.map((r) => ({
      statusId: r['status_id'] ? String(r['status_id']) : null,
      count: num(r['n']),
    }));
  }

  async bySales(ctx: QueryContext, metrics: readonly MetricKey[]) {
    const rows = await Promise.all(
      metrics.map(async (m) =>
        (
          await this.#run(
            ctx,
            sql`select x.sales_user_id as sales_user_id, ${countExpr(m)} as n from ${filteredUnits(ctx, m)} x group by x.sales_user_id`,
          )
        ).map((r) => ({
          salesUserId: r['sales_user_id'] ? String(r['sales_user_id']) : null,
          metric: m,
          value: num(r['n']),
        })),
      ),
    );
    return rows.flat();
  }

  async byPage(ctx: QueryContext, metrics: readonly MetricKey[]) {
    const rows = await Promise.all(
      metrics.map(async (m) =>
        (
          await this.#run(
            ctx,
            sql`select x.channel_id as channel_id, ${countExpr(m)} as n from ${filteredUnits(ctx, m)} x group by x.channel_id`,
          )
        ).map((r) => ({
          channelId: r['channel_id'] ? String(r['channel_id']) : null,
          metric: m,
          value: num(r['n']),
        })),
      ),
    );
    return rows.flat();
  }

  async drilldown(
    ctx: QueryContext,
    metric: MetricKey,
    filter: DrilldownFilter,
    page: { cursor: { at: Date; unitId: number } | null; limit: number },
  ) {
    const units = sql`${filteredUnits(ctx, metric)} x ${dimensionWhere(filter)}`;
    const [t] = await this.#run(ctx, sql`select ${countExpr(metric)} as n from ${units}`);
    // A metric that counts distinct customers lists each customer once (its latest unit).
    const key = { contact: sql`x.contact_id`, conversation: sql`x.conversation_id`, none: null }[
      definitionOf(metric).distinctKey
    ];
    const listed = key
      ? sql`(select distinct on (${key}) x.* from ${units} order by ${key}, x.at desc, x.unit_id desc)`
      : sql`(select x.* from ${units})`;
    const after = page.cursor
      ? sql`where (d.at, d.unit_id) < (${page.cursor.at.toISOString()}::timestamptz, ${page.cursor.unitId})`
      : sql``;
    const rows = await this.#run(
      ctx,
      sql`select d.* from ${listed} d ${after} order by d.at desc, d.unit_id desc limit ${page.limit + 1}`,
    );
    return {
      total: num(t?.['n']),
      rows: rows.map((r): UnitRow & { unitId: number } => ({
        unitId: num(r['unit_id']),
        at: toDate(r['at']),
        contactId: r['contact_id'] ? String(r['contact_id']) : null,
        conversationId: r['conversation_id'] ? String(r['conversation_id']) : null,
        channelId: r['channel_id'] ? String(r['channel_id']) : null,
        subjectId: r['subject_id'] ? String(r['subject_id']) : null,
        salesUserId: r['sales_user_id'] ? String(r['sales_user_id']) : null,
      })),
    };
  }
}
