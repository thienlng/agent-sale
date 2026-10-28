import { definitionOf, type MetricKey } from '@agent-sales/contracts';
import { type SQL, sql } from '@agent-sales/db';

import type { DrilldownFilter, QueryContext } from '../../domain/ports/read.js';

/**
 * The SQL of statistics. Every number (card, day, breakdown row, drilldown row) is computed from the
 * same relation of "units" per metric, so a card and its drilldown cannot disagree.
 *
 * A unit has: unit_id, contact_id, conversation_id, channel_id, at, day, subject_id, sales_user_id.
 * Temporal state is derived from facts: the owner at a time is the latest `assignment.changed` at or
 * before it; a tag is active between its assigned and removed facts; a status is the latest
 * `status.initial` / `status.changed` at or before the time.
 */

export const EVENT_KIND: Partial<Record<MetricKey, string>> = {
  'customers.new': 'customer.created',
  'phones.captured': 'phone.captured',
  'tags.assigned': 'tag.assigned',
  'tags.removed': 'tag.removed',
  'statuses.changed': 'status.changed',
  'conversations.opened': 'conversation.opened',
  'messages.inbound': 'message.inbound',
  'messages.outbound': 'message.outbound',
};

const ts = (d: Date) => sql`${d.toISOString()}::timestamptz`;

/** `col in (...)` for a list of strings; an empty list matches nothing. */
function inList(col: SQL, values: readonly string[], cast: string): SQL {
  if (!values.length) return sql`false`;
  return sql`${col} in (${sql.join(
    values.map((v) => sql`${v}::${sql.raw(cast)}`),
    sql`, `,
  )})`;
}

/**
 * Who owned the customer (`role`) at the time `at`, from the ownership facts. Attribution is frozen at
 * the watermark with the rest of the numbers; the scope of a viewer is not (`frozen: false`): what a
 * member may see is decided by who owns a customer now, whatever watermark a request names.
 */
function ownerAt(
  ctx: QueryContext,
  role: 'sales' | 'care',
  alias: string,
  at: SQL,
  frozen = true,
): SQL {
  const a = sql.raw(alias);
  const bound = frozen ? sql`and o.id <= ${ctx.watermark}` : sql``;
  return sql`(select o.subject_id from analytics_facts o
    where o.workspace_id = ${a}.workspace_id and o.contact_id = ${a}.contact_id
      and o.kind = 'assignment.changed' and o.role = ${role}
      and o.occurred_at <= ${at} ${bound}
    order by o.occurred_at desc, o.outbox_id desc limit 1)`;
}

/** The scope of a restricted viewer, same rule as the CRM: owns it, or nobody does. */
function scope(ctx: QueryContext, alias: string): SQL {
  if (!ctx.ownOnly) return sql``;
  const now = ts(ctx.generatedAt);
  const sales = ownerAt(ctx, 'sales', alias, now, false);
  const care = ownerAt(ctx, 'care', alias, now, false);
  return sql`and ((${sales} is null and ${care} is null) or ${sales} = ${ctx.ownOnly}::uuid or ${care} = ${ctx.ownOnly}::uuid)`;
}

const common = (ctx: QueryContext) =>
  sql`f.workspace_id = ${ctx.workspaceId}::uuid and f.id <= ${ctx.watermark}`;

/** The relation of units a metric counts. Throws for a derived metric (it has no units of its own). */
export function unitsSql(ctx: QueryContext, metric: MetricKey): SQL {
  const d = definitionOf(metric);
  const origins = ctx.origins[metric] ?? d.origins.default;
  const tz = ctx.timezone;

  if (metric === 'tags.current') {
    const asOf = ts(ctx.asOf);
    return sql`select f.id as unit_id, f.contact_id, null::uuid as conversation_id, null::uuid as channel_id,
        f.occurred_at as at, null::date as day, f.subject_id,
        ${ownerAt(ctx, 'sales', 'f', asOf)} as sales_user_id
      from analytics_facts f
      where ${common(ctx)} and f.kind = 'tag.assigned' and ${inList(sql`f.origin`, origins, 'text')}
        and f.occurred_at <= ${asOf}
        and not exists (select 1 from analytics_facts r
          where r.workspace_id = f.workspace_id and r.kind = 'tag.removed' and r.ref_id = f.ref_id
            and r.occurred_at <= ${asOf} and r.id <= ${ctx.watermark})
        ${scope(ctx, 'f')}`;
  }

  if (metric === 'statuses.current') {
    const asOf = ts(ctx.asOf);
    return sql`select f.id as unit_id, f.contact_id, null::uuid as conversation_id, null::uuid as channel_id,
        f.occurred_at as at, null::date as day,
        (select s.subject_id from analytics_facts s
          where s.workspace_id = f.workspace_id and s.contact_id = f.contact_id
            and s.kind in ('status.initial', 'status.changed')
            and s.occurred_at <= ${asOf} and s.id <= ${ctx.watermark}
          order by s.occurred_at desc, s.outbox_id desc limit 1) as subject_id,
        ${ownerAt(ctx, 'sales', 'f', asOf)} as sales_user_id
      from analytics_facts f
      where ${common(ctx)} and f.kind = 'customer.created' and f.occurred_at <= ${asOf}
        ${scope(ctx, 'f')}`;
  }

  const kind = EVENT_KIND[metric];
  if (!kind) throw new Error(`${metric} has no units of its own`);
  const page = ctx.pageIds ? sql`and ${inList(sql`f.channel_id`, ctx.pageIds, 'uuid')}` : sql``;
  const bot = ctx.botIds ? sql`and ${inList(sql`f.bot_id`, ctx.botIds, 'uuid')}` : sql``;
  return sql`select f.id as unit_id, f.contact_id, f.conversation_id, f.channel_id,
      f.occurred_at as at, (f.occurred_at at time zone ${tz})::date as day, f.subject_id,
      ${ownerAt(ctx, 'sales', 'f', sql`f.occurred_at`)} as sales_user_id
    from analytics_facts f
    where ${common(ctx)} and f.kind = ${kind} and ${inList(sql`f.origin`, origins, 'text')}
      and f.occurred_at >= ${ts(ctx.fromUtc)} and f.occurred_at < ${ts(ctx.toUtc)}
      ${page} ${bot} ${scope(ctx, 'f')}`;
}

/** Units after the viewer-chosen salesperson filter. */
export function filteredUnits(ctx: QueryContext, metric: MetricKey): SQL {
  const sales = ctx.salesIds
    ? sql`where ${inList(sql`u.sales_user_id`, ctx.salesIds, 'uuid')}`
    : sql``;
  return sql`(select u.* from (${unitsSql(ctx, metric)}) u ${sales})`;
}

/** What one counted unit is, per the definition. */
export function countExpr(metric: MetricKey): SQL {
  switch (definitionOf(metric).distinctKey) {
    case 'contact':
      return sql`count(distinct x.contact_id)`;
    case 'conversation':
      return sql`count(distinct x.conversation_id)`;
    default:
      return sql`count(*)`;
  }
}

export function dimensionWhere(filter: DrilldownFilter): SQL {
  const parts: SQL[] = [];
  if (filter.salesUserId !== undefined) {
    parts.push(
      filter.salesUserId === null
        ? sql`x.sales_user_id is null`
        : sql`x.sales_user_id = ${filter.salesUserId}::uuid`,
    );
  }
  if (filter.tagId) parts.push(sql`x.subject_id = ${filter.tagId}::uuid`);
  if (filter.statusId !== undefined) {
    parts.push(
      filter.statusId === null
        ? sql`x.subject_id is null`
        : sql`x.subject_id = ${filter.statusId}::uuid`,
    );
  }
  if (filter.channelId !== undefined) {
    parts.push(
      filter.channelId === null
        ? sql`x.channel_id is null`
        : sql`x.channel_id = ${filter.channelId}::uuid`,
    );
  }
  if (filter.date) parts.push(sql`x.day = ${filter.date}::date`);
  return parts.length ? sql`where ${sql.join(parts, sql` and `)}` : sql``;
}
