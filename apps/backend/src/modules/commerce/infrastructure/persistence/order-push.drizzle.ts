import { and, asc, eq, isNull, sql, type TenantTx } from '@agent-sales/db';

import { OrderExternalLinkConflictError } from '../../api/order-push.facade.js';
import type { CommerceTx, PushLineRecord } from '../../application/ports/commerce-store.js';
import { n, o, oi, p, pgCode, toOrder, v } from './commerce.rows.js';

/** PMS push columns of orders (ADR-017); eligibility mirrors `domain/order-push.ts`. */
export function orderPushTx(tx: TenantTx): Pick<CommerceTx, 'orderPush'> {
  return {
    orderPush: {
      async claim(source, since, settledBefore, limit) {
        // SKIP LOCKED: two scans at once take disjoint rows, so no order is claimed twice.
        const rows = await tx.execute<{ id: string }>(sql`
          update ${o} set external_state = 'pending', external_source = ${source}, updated_at = now()
          where ${o.id} in (
            select ${o.id} from ${o}
            where ${o.externalState} is null and ${o.deletedAt} is null
              and ${o.status} <> 'cancelled'
              and ${o.createdAt} >= ${since.toISOString()}
              and (${o.createdByKind} = 'agent' or (${o.createdByKind} = 'bot'
                and ${o.reviewState} = 'approved'
                and ${o.reviewedAt} < ${settledBefore.toISOString()}))
            order by ${o.createdAt}, ${o.id}
            limit ${limit}
            for update skip locked
          )
          returning ${o.id} as id`);
        return rows.map((r) => r.id);
      },
      async lock(orderId) {
        const [r] = await tx.select().from(o).where(eq(o.id, orderId)).limit(1).for('update');
        return r ? { ...toOrder(r), deleted: r.deletedAt !== null } : null;
      },
      async findByExternal(source, externalId) {
        const [r] = await tx
          .select()
          .from(o)
          .where(
            and(eq(o.externalSource, source), eq(o.externalId, externalId), isNull(o.deletedAt)),
          )
          .limit(1)
          .for('update');
        return r ? toOrder(r) : null;
      },
      async lines(orderId, source) {
        const rows = await tx
          .select({
            variantExternalId: v.externalId,
            productSource: p.externalSource,
            sku: oi.sku,
            productName: oi.productName,
            variantName: oi.variantName,
            qty: oi.qty,
            unitPrice: oi.unitPrice,
          })
          .from(oi)
          .leftJoin(v, eq(v.id, oi.variantId))
          .leftJoin(p, eq(p.id, v.productId))
          .where(eq(oi.orderId, orderId))
          .orderBy(asc(oi.position));
        return rows.map((r): PushLineRecord => ({
          externalVariantId:
            r.productSource === source && r.variantExternalId ? r.variantExternalId : null,
          sku: r.sku,
          productName: r.productName,
          variantName: r.variantName,
          qty: r.qty,
          unitPrice: r.unitPrice,
        }));
      },
      async set(orderId, patch) {
        const row = {
          ...(patch.source !== undefined ? { externalSource: patch.source } : {}),
          ...(patch.state !== undefined ? { externalState: patch.state } : {}),
          ...(patch.id !== undefined ? { externalId: patch.id } : {}),
          ...(patch.code !== undefined ? { externalCode: patch.code } : {}),
          ...(patch.status !== undefined ? { externalStatus: patch.status } : {}),
          ...(patch.error !== undefined ? { externalError: patch.error } : {}),
          ...(patch.pushedAt !== undefined ? { externalPushedAt: patch.pushedAt } : {}),
        };
        if (!Object.keys(row).length) return;
        try {
          await tx.update(o).set(row).where(eq(o.id, orderId));
        } catch (e) {
          const constraint = (e as { cause?: { constraint_name?: string } }).cause?.constraint_name;
          if (pgCode(e) === '23505' && constraint === 'orders_external')
            throw new OrderExternalLinkConflictError();
          throw e;
        }
      },
      async releasePending(source) {
        const rows = await tx
          .update(o)
          .set({ externalState: null, externalSource: null })
          .where(and(eq(o.externalSource, source), eq(o.externalState, 'pending')))
          .returning({ id: o.id });
        return rows.length;
      },
      async stalePending(source, since, olderThan, limit) {
        const rows = await tx
          .select({ id: o.id })
          .from(o)
          .where(
            and(
              eq(o.externalSource, source),
              eq(o.externalState, 'pending'),
              sql`${o.createdAt} >= ${since.toISOString()}`,
              sql`${o.updatedAt} < ${olderThan.toISOString()}`,
            ),
          )
          .orderBy(asc(o.updatedAt), asc(o.id))
          .limit(limit);
        return rows.map((r) => r.id);
      },
      async countPushed(source) {
        const [r] = await tx
          .select({ c: sql<number>`count(*)` })
          .from(o)
          .where(
            and(eq(o.externalSource, source), eq(o.externalState, 'pushed'), isNull(o.deletedAt)),
          );
        return n(r?.c);
      },
    },
  };
}
