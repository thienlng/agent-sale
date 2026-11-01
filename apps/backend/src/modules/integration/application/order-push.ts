import { DomainError, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  ORDER_PUSH_FACADE,
  OrderAlreadyPushedError,
  OrderExternalLinkConflictError,
  type OrderPushFacade,
  type PushableOrder,
} from '../../commerce/api/index.js';
import {
  IntegrationUnavailableError,
  KiotVietRejectedError,
} from '../domain/integration.errors.js';
import { carriesRapizCode, kiotVietOrderBody, orderStatusOf } from '../domain/kiotviet-order.js';
import { SOURCE } from './catalog-writer.js';
import {
  type ConnectionRecord,
  INTEGRATION_STORE,
  type IntegrationStore,
  type JobRecord,
} from './ports/integration-store.js';
import {
  KIOTVIET_GATEWAY,
  type KiotVietGateway,
  type KvCredentials,
  type KvOrderRef,
} from './ports/kiotviet-gateway.js';
import { JOB_LEASE_MS, LeaseLostError, PAGE_SIZE } from './sync-context.js';

/** How often the runner claims orders to push (spec §7). */
export const PUSH_SCAN_MS = 15_000;
/** Orders claimed per connection and scan. */
export const PUSH_BATCH = 20;
/** The lookup after an ambiguous failure reads orders modified from this long before the first attempt. */
const LOOKUP_SLACK_MS = 60_000;
/** Pages of recent orders read when looking for one already stored. */
const LOOKUP_MAX_PAGES = 10;
/** A pending order with no open job this long after its claim lost its job (crash between claim and enqueue). */
export const STALE_PENDING_MS = 2 * 60_000;
/** Pages of KiotViet orders a reconcile reads to repair missed `order.update` deliveries. */
const STATUS_MAX_PAGES = 20;

/**
 * A push attempt failed after the order was read: carries the order code so the failure path can
 * log it (rule 07: codes, never customer data).
 */
export class PushAttemptError extends Error {
  orderCode = '';

  static of(cause: unknown, orderCode: string): PushAttemptError {
    const error = new PushAttemptError('order push attempt failed', { cause });
    error.orderCode = orderCode;
    return error;
  }
}

/**
 * Pushes Rapiz orders to KiotViet (spec §7): the 15 s scan that claims eligible orders and queues
 * one `push_order` job each, and the job itself. Idempotent across retries: the job marks its cursor
 * `ambiguous` before `POST /orders`, and every later attempt first adopts the KiotViet order whose
 * description carries the Rapiz code, so a retry never creates a duplicate.
 */
@Injectable()
export class OrderPusher {
  private readonly logger = new Logger(OrderPusher.name);

  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(KIOTVIET_GATEWAY) private readonly gateway: KiotVietGateway,
    @Inject(ORDER_PUSH_FACADE) private readonly orders: OrderPushFacade,
  ) {}

  /**
   * Claims eligible orders of every pushing connection and queues one job per order; also re-queues
   * pending orders whose job was lost (claimed more than `STALE_PENDING_MS` ago, no open job).
   */
  async scan(): Promise<void> {
    for (const c of await this.store.connectionsPushingOrders()) {
      try {
        const ws = c.workspaceId;
        const claimed = await this.orders.claimOrdersForPush(ws, SOURCE, c.createdAt, PUSH_BATCH);
        const stale = await this.orders.stalePendingOrders(
          ws,
          SOURCE,
          c.createdAt,
          new Date(Date.now() - STALE_PENDING_MS),
          PUSH_BATCH,
        );
        for (const orderId of new Set([...claimed, ...stale])) {
          await this.queue(ws, c.connectionId, orderId);
        }
      } catch (error) {
        if (error instanceof IntegrationUnavailableError) throw error;
        this.logger.warn(`Connection ${c.connectionId}: push scan failed (${errorName(error)})`);
      }
    }
  }

  /**
   * One `push_order` job for the order, unless one is still open (never two at once for an order).
   * When an earlier attempt may have reached KiotViet (its job cursor or payload says `ambiguous`),
   * the new job inherits that, with the first attempt time and branch, so it looks before creating:
   * "Thử lại" after a lost answer never duplicates the order.
   */
  private async queue(ws: WorkspaceId, connectionId: string, orderId: string): Promise<void> {
    const last = await this.store.latestPushJob(ws, orderId);
    if (last?.open) return;
    const payload: Record<string, unknown> = {
      orderId,
      firstAttemptAt: new Date().toISOString(),
    };
    if (last && (last.cursor?.['ambiguous'] === true || last.payload['ambiguous'] === true)) {
      payload['ambiguous'] = true;
      payload['firstAttemptAt'] = last.payload['firstAttemptAt'] ?? payload['firstAttemptAt'];
      const branchId = last.cursor?.['branchId'] ?? last.payload['branchId'];
      if (typeof branchId === 'number') payload['branchId'] = branchId;
    }
    await this.store.enqueue(ws, { connectionId, kind: 'push_order', payload });
  }

  /**
   * Reconcile: re-reads the order branch's KiotViet orders modified since `since` and applies their
   * status, so a lost `order.update` delivery is repaired (orders Rapiz did not push are ignored).
   */
  async reconcileStatuses(c: ConnectionRecord, creds: KvCredentials, since: Date): Promise<void> {
    for (let page = 0; page < STATUS_MAX_PAGES; page += 1) {
      const currentItem = page * PAGE_SIZE;
      const res = await this.gateway.recentOrders(creds, {
        branchId: c.settings.orderBranchId,
        since,
        currentItem,
        pageSize: PAGE_SIZE,
      });
      for (const o of res.data) {
        await this.orders.applyExternalOrderStatus(
          c.workspaceId,
          SOURCE,
          String(o.id),
          orderStatusOf(o.status),
        );
      }
      if (res.data.length === 0 || currentItem + PAGE_SIZE >= res.total) return;
    }
    this.logger.warn(`Connection ${c.id}: order statuses stopped after ${STATUS_MAX_PAGES} pages`);
  }

  /** "Thử lại": a failed push goes back to the queue (409 when it is not failed). */
  retry(ws: WorkspaceId, orderId: string): Promise<void> {
    return this.orders.requeueOrderPush(ws, orderId);
  }

  /**
   * Runs one claimed `push_order` job. Problems the order itself has (unlinked product, KiotViet
   * rejecting the body, already pushed) end the job here; KiotViet and auth errors are rethrown as
   * `PushAttemptError` for the shared retry and auth path of `SyncService`.
   */
  async run(
    job: JobRecord,
    connection: ConnectionRecord,
    credentials: () => KvCredentials,
  ): Promise<void> {
    const ws = job.workspaceId;
    const orderId = orderIdOf(job);
    const found = await this.orders.pushableOrder(ws, orderId);
    if (!found) {
      // Pushed, failed or cancelled meanwhile: nothing to do.
      await this.complete(job);
      return;
    }
    if ('problem' in found) {
      const { problem } = found;
      await this.orders.markOrderPushFailed(
        ws,
        orderId,
        problem.reason === 'unlinked_product'
          ? { code: 'unlinked_product', params: { name: problem.name } }
          : { code: 'empty_order' },
      );
      await this.logFailed(ws, connection.id, found.code, problem.reason);
      await this.complete(job);
      return;
    }

    const order = found.order;
    let ref: KvOrderRef;
    try {
      ref = await this.pushOnce(job, connection, credentials(), order);
    } catch (error) {
      if (error instanceof LeaseLostError) throw error;
      if (error instanceof KiotVietRejectedError) {
        await this.orders.markOrderPushFailed(ws, orderId, { code: 'kiotviet_rejected' });
        await this.logFailed(ws, connection.id, order.code, 'kiotviet_rejected');
        await this.complete(job);
        return;
      }
      throw PushAttemptError.of(error, order.code);
    }
    await this.record(job, connection, order, ref);
  }

  /**
   * The job gave up (`reason`: `auth_failed`, `kiotviet_unavailable`, `sync_failed`): the order is
   * marked failed so staff can "Thử lại", and the failure is logged.
   */
  async abandon(job: JobRecord, reason: string, orderCode: string | null): Promise<void> {
    const ws = job.workspaceId;
    const orderId = orderIdOf(job);
    let code = orderCode;
    if (code === null) {
      const found = await this.orders.pushableOrder(ws, orderId);
      if (!found) return;
      code = 'problem' in found ? found.code : found.order.code;
    }
    await this.orders.markOrderPushFailed(ws, orderId, { code: reason });
    await this.logFailed(ws, job.connectionId, code, reason);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * The KiotViet order for this Rapiz order: the one an earlier attempt stored, else a new one. The
   * cursor says `ambiguous` before the create, so any failure from there on (a lost answer, a
   * crash, a failed write in Rapiz) makes the next attempt look first.
   */
  private async pushOnce(
    job: JobRecord,
    connection: ConnectionRecord,
    creds: KvCredentials,
    order: PushableOrder,
  ): Promise<KvOrderRef> {
    const branchId = connection.settings.orderBranchId;
    const cursor = job.cursor ?? {};
    if (cursor['ambiguous'] === true || job.payload['ambiguous'] === true) {
      // Where the earlier attempt sent it (the owner may have changed the order branch since).
      const tried = cursor['branchId'] ?? job.payload['branchId'];
      const lookIn = typeof tried === 'number' ? tried : branchId;
      const stored = await this.findStored(creds, lookIn, order.code, lookupSince(job));
      if (stored) return stored;
    }
    const saved = await this.store.saveCursor(
      job.id,
      job.claimToken,
      { ambiguous: true, branchId },
      JOB_LEASE_MS,
    );
    if (!saved) throw new LeaseLostError();
    return this.gateway.createOrder(creds, kiotVietOrderBody(order, branchId));
  }

  private async findStored(
    creds: KvCredentials,
    branchId: number,
    code: string,
    since: Date,
  ): Promise<KvOrderRef | null> {
    for (let page = 0; page < LOOKUP_MAX_PAGES; page += 1) {
      const currentItem = page * PAGE_SIZE;
      const res = await this.gateway.recentOrders(creds, {
        branchId,
        since,
        currentItem,
        pageSize: PAGE_SIZE,
      });
      const hit = res.data.find((o) => carriesRapizCode(o.description, code));
      if (hit) return { id: hit.id, code: hit.code, status: hit.status };
      if (res.data.length === 0 || currentItem + PAGE_SIZE >= res.total) return null;
    }
    this.logger.warn(`Order lookup stopped after ${LOOKUP_MAX_PAGES} pages`);
    return null;
  }

  private async record(
    job: JobRecord,
    connection: ConnectionRecord,
    order: PushableOrder,
    ref: KvOrderRef,
  ): Promise<void> {
    const ws = job.workspaceId;
    let cancelled: boolean;
    try {
      ({ cancelled } = await this.orders.markOrderPushed(ws, order.id, {
        externalId: String(ref.id),
        externalCode: ref.code,
        externalStatus: orderStatusOf(ref.status).code,
      }));
    } catch (error) {
      if (error instanceof OrderAlreadyPushedError) {
        // KiotViet now holds a second order for it: staff cancel that one there.
        await this.store.log(ws, connection.id, {
          level: 'warning',
          code: 'order_push_duplicate',
          params: { code: order.code },
        });
        await this.complete(job);
        return;
      }
      if (error instanceof OrderExternalLinkConflictError) {
        await this.orders.markOrderPushFailed(ws, order.id, { code: 'kiotviet_link_conflict' });
        await this.logFailed(ws, connection.id, order.code, 'link_conflict');
        await this.complete(job);
        return;
      }
      if (error instanceof DomainError && error.code === 'NOT_FOUND') {
        // Deleted meanwhile: the KiotViet order exists without a Rapiz order.
        await this.logCancelled(ws, connection.id, order.code);
        await this.complete(job);
        return;
      }
      throw PushAttemptError.of(error, order.code);
    }

    if (cancelled) await this.logCancelled(ws, connection.id, order.code);
    else {
      await this.store.log(ws, connection.id, {
        level: 'info',
        code: 'order_pushed',
        params: { code: order.code },
      });
    }
    await this.updateCount(ws, connection.id);
    await this.complete(job);
  }

  private async updateCount(ws: WorkspaceId, connectionId: string): Promise<void> {
    const count = await this.orders.pushedOrderCount(ws, SOURCE);
    const latest = await this.store.connectionForSystem(connectionId);
    if (!latest || latest.status === 'disconnected') return;
    await this.store.updateConnection(ws, connectionId, {
      counts: { ...latest.counts, ordersPushed: count },
    });
  }

  private logFailed(ws: WorkspaceId, connectionId: string, code: string, reason: string) {
    return this.store.log(ws, connectionId, {
      level: 'warning',
      code: 'order_push_failed',
      params: { code, reason },
    });
  }

  /** The order was cancelled in Rapiz after KiotViet took it: staff must cancel it there too. */
  private logCancelled(ws: WorkspaceId, connectionId: string, code: string) {
    return this.store.log(ws, connectionId, {
      level: 'warning',
      code: 'order_pushed_cancelled',
      params: { code },
    });
  }

  private async complete(job: JobRecord): Promise<void> {
    await this.store.completeJob(job.id, job.claimToken);
  }
}

const orderIdOf = (job: JobRecord): string => String(job.payload['orderId'] ?? '');

/** A minute before the job's first attempt (a day back when the payload lacks it). */
function lookupSince(job: JobRecord): Date {
  const first = Date.parse(String(job.payload['firstAttemptAt'] ?? ''));
  return new Date((Number.isNaN(first) ? Date.now() - 86_400_000 : first) - LOOKUP_SLACK_MS);
}

const errorName = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : 'unknown';
