import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  schema,
  sql,
  type TenantTx,
} from '@agent-sales/db';
import type { WorkspaceId } from '@agent-sales/shared';

import type {
  CommerceTx,
  HistoryRecord,
  OrderItemRecord,
  OrderListFilter,
  OrderListResult,
  OverviewAggregates,
} from '../../application/ports/commerce-store.js';
import type { OrderStatus } from '../../domain/order-stock.js';
import { DuplicateOrderRequestError } from '../../domain/commerce.errors.js';
import {
  contains,
  h,
  isClosed,
  n,
  o,
  oi,
  orderRow,
  p,
  v,
  pgCode,
  profitExpr,
  toOrder,
} from './commerce.rows.js';

/** Bot orders waiting for review; cancelling one rejects it (partial index orders_review_pending_idx). */
const pendingReview = and(eq(o.reviewState, 'pending'), notInArray(o.status, ['cancelled']));

/** Orders, their history and settings inside one tenant transaction. */
export function ordersTx(ws: WorkspaceId, tx: TenantTx): Pick<CommerceTx, 'orders' | 'settings'> {
  return {
    orders: {
      async nextCode(workspaceId) {
        const [r] = await tx
          .insert(schema.orderCounters)
          .values({ workspaceId, lastValue: 1 })
          .onConflictDoUpdate({
            target: schema.orderCounters.workspaceId,
            set: { lastValue: sql`${schema.orderCounters.lastValue} + 1` },
          })
          .returning({ value: schema.orderCounters.lastValue });
        return `DH${String(r?.value ?? 1).padStart(6, '0')}`;
      },
      async insert(rec, items) {
        try {
          await tx.insert(o).values(orderRow(ws, rec));
        } catch (e) {
          if (pgCode(e) === '23505' && rec.clientRequestId) throw new DuplicateOrderRequestError();
          throw e;
        }
        await tx.insert(oi).values(items.map((i) => ({ ...i, workspaceId: ws, orderId: rec.id })));
      },
      async find(id, opts) {
        const q = tx
          .select()
          .from(o)
          .where(and(eq(o.id, id), isNull(o.deletedAt)))
          .limit(1);
        // forUpdate: the row stays locked until the transaction ends, so concurrent
        // edits and status changes of one order run one after the other.
        const [r] = opts?.forUpdate ? await q.for('update') : await q;
        return r ? toOrder(r) : null;
      },
      async findByRequestId(requestId) {
        const [r] = await tx.select().from(o).where(eq(o.clientRequestId, requestId)).limit(1);
        return r ? toOrder(r) : null;
      },
      async itemsOf(orderId) {
        const rows = await tx
          .select()
          .from(oi)
          .where(eq(oi.orderId, orderId))
          .orderBy(asc(oi.position));
        return rows.map((r): OrderItemRecord => ({
          id: r.id,
          variantId: r.variantId,
          productName: r.productName,
          variantName: r.variantName,
          sku: r.sku,
          qty: r.qty,
          unitPrice: r.unitPrice,
          unitCost: r.unitCost,
          lineTotal: r.lineTotal,
          position: r.position,
        }));
      },
      async historyOf(orderId) {
        const rows = await tx
          .select()
          .from(h)
          .where(eq(h.orderId, orderId))
          .orderBy(asc(h.createdAt));
        return rows.map((r): HistoryRecord => ({
          fromStatus: r.fromStatus as OrderStatus | null,
          toStatus: r.toStatus as OrderStatus,
          note: r.note,
          actorUserId: r.actorUserId,
          actorName: r.actorName,
          createdAt: r.createdAt,
        }));
      },
      async update(rec) {
        const { id: _id, ...row } = orderRow(ws, rec);
        await tx.update(o).set(row).where(eq(o.id, rec.id));
      },
      async replaceItems(orderId, items) {
        await tx.delete(oi).where(eq(oi.orderId, orderId));
        await tx.insert(oi).values(items.map((i) => ({ ...i, workspaceId: ws, orderId })));
      },
      async addHistory(workspaceId, orderId, entry) {
        await tx.insert(h).values({ id: crypto.randomUUID(), workspaceId, orderId, ...entry });
      },
      async list(f: OrderListFilter): Promise<OrderListResult> {
        const base = and(
          isNull(o.deletedAt),
          f.q ? contains(o.searchText, f.q) : undefined,
          f.source ? eq(o.source, f.source) : undefined,
          f.from ? sql`${o.placedAt} >= ${f.from.toISOString()}` : undefined,
          f.to ? sql`${o.placedAt} < ${f.to.toISOString()}` : undefined,
          f.createdBy ? eq(o.createdByUserId, f.createdBy) : undefined,
          f.carrier ? eq(o.carrier, f.carrier) : undefined,
          f.review ? pendingReview : undefined,
        );
        // Status is the only filter the per-status counts ignore (they label the choices).
        const statusFilter = f.statuses?.length
          ? f.statusMode === 'exclude'
            ? notInArray(o.status, f.statuses)
            : inArray(o.status, f.statuses)
          : undefined;
        const where = and(base, statusFilter);
        const order = {
          placed_desc: [desc(o.placedAt), desc(o.code)],
          placed_asc: [asc(o.placedAt), asc(o.code)],
          total_desc: [desc(o.total), desc(o.placedAt)],
          total_asc: [asc(o.total), desc(o.placedAt)],
        }[f.sort];
        const [rows, countRows, [totals], creators, carriers] = await Promise.all([
          tx
            .select()
            .from(o)
            .where(where)
            .orderBy(...order)
            .offset(f.offset)
            .limit(f.limit),
          tx
            .select({ status: o.status, c: sql<number>`count(*)` })
            .from(o)
            .where(base)
            .groupBy(o.status),
          tx
            .select({
              c: sql<number>`count(*)`,
              itemQty: sql<number>`coalesce(sum(${o.itemQty}), 0)`,
              shippingFeeCharged: sql<number>`coalesce(sum(${o.shippingFeeCharged}), 0)`,
              cod: sql<number>`coalesce(sum(${o.codAmount}), 0)`,
              gross: sql<number>`coalesce(sum(${o.subtotal} + ${o.shippingFeeCharged} + ${o.surcharge}), 0)`,
              total: sql<number>`coalesce(sum(${o.total}), 0)`,
            })
            .from(o)
            .where(where),
          tx
            .selectDistinctOn([o.createdByUserId], {
              id: o.createdByUserId,
              name: o.createdByName,
            })
            .from(o)
            .where(and(isNull(o.deletedAt), isNotNull(o.createdByUserId)))
            .orderBy(o.createdByUserId, desc(o.createdAt))
            .limit(100),
          tx
            .selectDistinct({ carrier: o.carrier })
            .from(o)
            .where(and(isNull(o.deletedAt), isNotNull(o.carrier)))
            .orderBy(o.carrier)
            .limit(100),
        ]);
        const ids = rows.map((r) => r.id);
        const items = ids.length
          ? await tx
              .select({
                orderId: oi.orderId,
                productName: oi.productName,
                variantName: oi.variantName,
                qty: oi.qty,
                unitPrice: oi.unitPrice,
                // The product's current primary picture (the line keeps only names and prices).
                imageUrl: sql<string | null>`${p.imageUrls} ->> 0`,
              })
              .from(oi)
              .leftJoin(v, eq(v.id, oi.variantId))
              .leftJoin(p, eq(p.id, v.productId))
              .where(inArray(oi.orderId, ids))
              .orderBy(asc(oi.position))
          : [];
        const counts: Record<string, number> = { all: 0 };
        for (const c of countRows) {
          counts[c.status] = n(c.c);
          counts['all'] = (counts['all'] ?? 0) + n(c.c);
        }
        return {
          rows: rows.map((r) => ({
            ...toOrder(r),
            itemsPreview: items
              .filter((i) => i.orderId === r.id)
              .slice(0, 3)
              .map((i) => ({
                name: [i.productName, i.variantName].filter(Boolean).join(' – '),
                qty: i.qty,
                variantName: i.variantName || null,
                unitPrice: i.unitPrice,
                imageUrl: i.imageUrl ?? null,
              })),
          })),
          total: n(totals?.c),
          counts,
          totals: {
            itemQty: n(totals?.itemQty),
            shippingFeeCharged: n(totals?.shippingFeeCharged),
            cod: n(totals?.cod),
            gross: n(totals?.gross),
            total: n(totals?.total),
          },
          facets: {
            creators: creators
              .flatMap((c) => (c.id ? [{ id: c.id, name: c.name ?? '' }] : []))
              .sort((a, b) => a.name.localeCompare(b.name, 'vi')),
            carriers: carriers.flatMap((c) => (c.carrier ? [c.carrier] : [])),
          },
        };
      },
      async countPendingReview() {
        const [r] = await tx
          .select({ c: sql<number>`count(*)` })
          .from(o)
          .where(and(isNull(o.deletedAt), pendingReview));
        return n(r?.c);
      },
      async overview({ from, to, todayFrom, todayTo, timezone }): Promise<OverviewAggregates> {
        const localDay = sql<string>`to_char(${o.placedAt} at time zone ${timezone}, 'YYYY-MM-DD')`;
        const inRange = (a: Date, b: Date) =>
          and(
            isNull(o.deletedAt),
            sql`${o.placedAt} >= ${a.toISOString()}`,
            sql`${o.placedAt} < ${b.toISOString()}`,
          );
        const [byDay, [returned], [today], byHour, [cancelled]] = await Promise.all([
          tx
            .select({
              date: localDay,
              sales: sql<number>`coalesce(sum(${o.total}) filter (where ${o.status} <> 'cancelled'), 0)`,
              revenue: sql<number>`coalesce(sum(${o.total}) filter (where ${isClosed}), 0)`,
              profit: sql<number>`coalesce(sum(${profitExpr}) filter (where ${isClosed}), 0)`,
              closedOrders: sql<number>`count(*) filter (where ${isClosed})`,
              productQty: sql<number>`coalesce(sum(${o.itemQty}) filter (where ${isClosed}), 0)`,
            })
            .from(o)
            .where(inRange(from, to))
            // By position: repeating the expression would bind the time zone as a second parameter.
            .groupBy(sql`1`),
          tx
            .select({
              amount: sql<number>`coalesce(sum(${o.total}), 0)`,
              productQty: sql<number>`coalesce(sum(${o.itemQty}), 0)`,
            })
            .from(o)
            .where(and(inRange(from, to), inArray(o.status, ['returning', 'returned']))),
          tx
            .select({
              revenue: sql<number>`coalesce(sum(${o.total}) filter (where ${isClosed}), 0)`,
              closedOrders: sql<number>`count(*) filter (where ${isClosed})`,
              created: sql<number>`count(*)`,
              productQty: sql<number>`coalesce(sum(${o.itemQty}) filter (where ${isClosed}), 0)`,
            })
            .from(o)
            .where(inRange(todayFrom, todayTo)),
          tx
            .select({
              hour: sql<number>`extract(hour from ${o.placedAt} at time zone ${timezone})::int`,
              revenue: sql<number>`coalesce(sum(${o.total}), 0)`,
            })
            .from(o)
            .where(and(inRange(todayFrom, todayTo), isClosed))
            .groupBy(sql`1`),
          tx
            .select({ c: sql<number>`count(*)` })
            .from(o)
            .where(
              and(
                isNull(o.deletedAt),
                sql`${o.cancelledAt} >= ${todayFrom.toISOString()}`,
                sql`${o.cancelledAt} < ${todayTo.toISOString()}`,
              ),
            ),
        ]);
        const hours = new Map(byHour.map((r) => [n(r.hour), n(r.revenue)]));
        return {
          byDay: byDay.map((d) => ({
            date: d.date,
            sales: n(d.sales),
            revenue: n(d.revenue),
            profit: n(d.profit),
            closedOrders: n(d.closedOrders),
            productQty: n(d.productQty),
          })),
          returned: { amount: n(returned?.amount), productQty: n(returned?.productQty) },
          today: {
            revenue: n(today?.revenue),
            closedOrders: n(today?.closedOrders),
            created: n(today?.created),
            cancelled: n(cancelled?.c),
            productQty: n(today?.productQty),
            byHour: Array.from({ length: 24 }, (_, hour) => ({
              hour,
              revenue: hours.get(hour) ?? 0,
            })),
          },
        };
      },
    },

    settings: {
      async get() {
        const [r] = await tx.select().from(schema.orderSettings).limit(1);
        return r
          ? {
              extraStatuses: r.extraStatuses,
              requireNoteStatuses: r.requireNoteStatuses,
              policies: r.policies,
              version: r.version,
            }
          : null;
      },
      async put(workspaceId, { version, ...s }) {
        const t = schema.orderSettings;
        // Insert the first save, or update only the version the caller loaded.
        const [r] = await tx
          .insert(t)
          .values({ workspaceId, ...s, version: 1 })
          .onConflictDoUpdate({
            target: t.workspaceId,
            set: { ...s, version: sql`${t.version} + 1`, updatedAt: new Date() },
            setWhere: eq(t.version, version),
          })
          .returning({ version: t.version });
        // A first insert must also have been expected as "never saved".
        if (!r || (r.version === 1 && version !== 0)) return null;
        return r.version;
      },
    },
  };
}
