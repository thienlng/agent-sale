import { isUuid, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { ExternalSource } from '../api/catalog-sync.facade.js';
import {
  OrderAlreadyPushedError,
  type OrderPushFacade,
  type PushableOrder,
  type PushProblem,
} from '../api/order-push.facade.js';
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
  ): Promise<{ order: PushableOrder } | { problem: PushProblem; code: string } | null> {
    return this.store.run(ws, async (tx) => {
      // Locked: a cancellation and the claim's release cannot interleave.
      const o = isUuid(orderId) ? await tx.orderPush.lock(orderId) : null;
      if (!o || o.external?.state !== 'pending' || !o.external.source) return null;
      if (o.status === 'cancelled' || o.deleted) {
        // Cancelled (or deleted) since the claim: nothing to push, and not a failure. Reviving the
        // order makes it eligible again.
        await tx.orderPush.set(o.id, { state: null, source: null });
        return null;
      }
      const payload = pushPayload(o, await tx.orderPush.lines(o.id, o.external.source));
      return 'problem' in payload ? { ...payload, code: o.code } : payload;
    });
  }

  markOrderPushed(
    ws: WorkspaceId,
    orderId: string,
    ref: { externalId: string; externalCode: string; externalStatus: string },
  ): Promise<{ cancelled: boolean }> {
    return this.store.run(ws, async (tx) => {
      const o = await this.#locked(tx, orderId);
      const cancelled = o.status === 'cancelled';
      if (o.external?.state === 'pushed') {
        if (o.external.id === ref.externalId) return { cancelled };
        throw new OrderAlreadyPushedError(o.external.code);
      }
      const now = new Date();
      if (o.stockState === 'reserved') {
        // The PMS takes the order's goods from here: Rapiz gives its hold back.
        const items = await tx.orders.itemsOf(o.id);
        await tx.inventory.apply(ws, stockChanges(['release'], o, items, null));
      }
      await tx.orders.update({ ...o, stockState: 'external', updatedAt: now });
      await tx.orderPush.set(o.id, {
        // Kiotviet is the only source; an order pushed without a claim takes it.
        source: o.external?.source ?? 'kiotviet',
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
      return { cancelled };
    });
  }

  markOrderPushFailed(
    ws: WorkspaceId,
    orderId: string,
    error: { code: string; params?: Record<string, string | number> },
  ): Promise<void> {
    return this.store.run(ws, async (tx) => {
      const o = await this.#locked(tx, orderId);
      if (o.external?.state !== 'pending') return;
      await tx.orderPush.set(o.id, {
        state: 'failed',
        error: error.params ? { code: error.code, params: error.params } : { code: error.code },
      });
    });
  }

  requeueOrderPush(
    ws: WorkspaceId,
    orderId: string,
    since: Date,
  ): Promise<'requeued' | 'before_since'> {
    return this.store.run(ws, async (tx) => {
      const o = await this.#locked(tx, orderId);
      const state = o.external?.state ?? null;
      if (state !== 'failed') throw new OrderPushNotFailedError(state);
      if (o.createdAt < since) return 'before_since';
      await tx.orderPush.set(o.id, { state: null, source: null, error: null });
      return 'requeued';
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

  releasePendingPushes(ws: WorkspaceId, source: ExternalSource, olderThan?: Date): Promise<number> {
    return this.store.run(ws, (tx) => tx.orderPush.releasePending(source, olderThan));
  }

  stalePendingOrders(
    ws: WorkspaceId,
    source: ExternalSource,
    since: Date,
    olderThan: Date,
    limit: number,
  ): Promise<string[]> {
    return this.store.run(ws, (tx) =>
      tx.orderPush.stalePending(source, since, olderThan, Math.max(0, Math.trunc(limit))),
    );
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
