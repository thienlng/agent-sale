import { isUuid, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { ExternalSource } from '../api/catalog-sync.facade.js';
import type { OrderPushFacade, PushableOrder, PushProblem } from '../api/order-push.facade.js';
import { OrderNotFoundError, OrderPushNotFailedError } from '../domain/commerce.errors.js';
import {
  EXTERNAL_CANCELLED_HISTORY_NOTE,
  PUSH_SETTLE_MS,
  pushedHistoryNote,
  pushPayload,
} from '../domain/order-push.js';
import { stockTransition } from '../domain/order-stock.js';
import { stockChanges } from './order.mappers.js';
import {
  COMMERCE_STORE,
  type CommerceStore,
  type CommerceTx,
  type OrderRecord,
} from './ports/commerce-store.js';

/**
 * Order push to a PMS (ADR-017, spec §7): the claim, the payload, the hand-over of an order's
 * stock to the PMS and the PMS's status changes. Every write locks the order row.
 */
@Injectable()
export class OrderPushService implements OrderPushFacade {
  constructor(@Inject(COMMERCE_STORE) private readonly store: CommerceStore) {}

  claimOrdersForPush(
    ws: WorkspaceId,
    source: ExternalSource,
    since: Date,
    limit: number,
  ): Promise<string[]> {
    const settledBefore = new Date(Date.now() - PUSH_SETTLE_MS);
    return this.store.run(ws, (tx) =>
      tx.orderPush.claim(source, since, settledBefore, Math.max(0, Math.trunc(limit))),
    );
  }

  pushableOrder(
    ws: WorkspaceId,
    orderId: string,
  ): Promise<{ order: PushableOrder } | { problem: PushProblem } | null> {
    return this.store.run(ws, async (tx) => {
      const o = isUuid(orderId) ? await tx.orders.find(orderId) : null;
      if (!o || o.external?.state !== 'pending' || !o.external.source) return null;
      if (o.status === 'cancelled') return null;
      return pushPayload(o, await tx.orderPush.lines(o.id, o.external.source));
    });
  }

  markOrderPushed(
    ws: WorkspaceId,
    orderId: string,
    ref: { externalId: string; externalCode: string; externalStatus: string },
  ): Promise<void> {
    return this.store.run(ws, async (tx) => {
      const o = await this.#locked(tx, orderId);
      if (o.external?.state === 'pushed' && o.external.id === ref.externalId) return;
      const now = new Date();
      if (o.stockState === 'reserved') {
        // The PMS takes the order's goods from here: Rapiz gives its hold back.
        const items = await tx.orders.itemsOf(o.id);
        await tx.inventory.apply(ws, stockChanges(['release'], o, items, null));
      }
      await tx.orders.update({ ...o, stockState: 'external', updatedAt: now });
      await tx.orderPush.set(o.id, {
        state: 'pushed',
        id: ref.externalId,
        code: ref.externalCode,
        status: ref.externalStatus,
        error: null,
        pushedAt: now,
      });
      await tx.orders.addHistory(ws, o.id, {
        fromStatus: o.status,
        toStatus: o.status,
        note: pushedHistoryNote(ref.externalCode),
        actorUserId: null,
        actorName: null,
        createdAt: now,
      });
    });
  }

  markOrderPushFailed(
    ws: WorkspaceId,
    orderId: string,
    error: { code: string; params?: Record<string, string | number> },
  ): Promise<void> {
    return this.store.run(ws, async (tx) => {
      const o = await this.#locked(tx, orderId);
      if (o.external?.state === 'pushed') return;
      await tx.orderPush.set(o.id, {
        state: 'failed',
        error: error.params ? { code: error.code, params: error.params } : { code: error.code },
      });
    });
  }

  requeueOrderPush(ws: WorkspaceId, orderId: string): Promise<void> {
    return this.store.run(ws, async (tx) => {
      const o = await this.#locked(tx, orderId);
      const state = o.external?.state ?? null;
      if (state !== 'failed') throw new OrderPushNotFailedError(state);
      await tx.orderPush.set(o.id, { state: null, error: null });
    });
  }

  applyExternalOrderStatus(
    ws: WorkspaceId,
    source: ExternalSource,
    externalId: string,
    status: { code: string; cancelled: boolean },
  ): Promise<'updated' | 'cancelled' | 'unknown'> {
    return this.store.run(ws, async (tx) => {
      const o = await tx.orderPush.findByExternal(source, externalId);
      if (!o) return 'unknown';
      await tx.orderPush.set(o.id, { status: status.code });
      if (!status.cancelled || o.status === 'cancelled') return 'updated';
      // Pushed orders are `external`: the transition moves no Rapiz stock.
      const stock = stockTransition(o.stockState, 'cancelled');
      const items = stock.actions.length ? await tx.orders.itemsOf(o.id) : [];
      await tx.inventory.apply(ws, stockChanges(stock.actions, o, items, null));
      const now = new Date();
      await tx.orders.update({
        ...o,
        status: 'cancelled',
        stockState: stock.next,
        cancelledAt: now,
        updatedAt: now,
      });
      await tx.orders.addHistory(ws, o.id, {
        fromStatus: o.status,
        toStatus: 'cancelled',
        note: EXTERNAL_CANCELLED_HISTORY_NOTE,
        actorUserId: null,
        actorName: null,
        createdAt: now,
      });
      return 'cancelled';
    });
  }

  pushedOrderCount(ws: WorkspaceId, source: ExternalSource): Promise<number> {
    return this.store.run(ws, (tx) => tx.orderPush.countPushed(source));
  }

  async #locked(tx: CommerceTx, orderId: string): Promise<OrderRecord> {
    const o = isUuid(orderId) ? await tx.orders.find(orderId, { forUpdate: true }) : null;
    if (!o) throw new OrderNotFoundError(orderId);
    return o;
  }
}
