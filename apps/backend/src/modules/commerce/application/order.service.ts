import type { OrderListQuery as OrderListSchema } from '@agent-sales/contracts';
import {
  type ChangeOrderStatusRequest,
  CLOSED_ORDER_STATUSES,
  CreateOrderRequest as CreateOrderSchema,
  type CreateOrderRequest,
  FULFILMENT_ORDER_STATUSES,
  type OrderDto,
  type OrderListResponse,
  type OrderOverviewResponse,
  type OrderSettingsDto,
  OrderSettingsDto as OrderSettingsSchema,
  UpdateOrderRequest as UpdateOrderSchema,
  type UpdateOrderRequest,
} from '@agent-sales/contracts';
import { foldVietnamese, isUuid, newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';

import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import {
  DuplicateOrderRequestError,
  NoWarehouseError,
  OrderDiscountError,
  OrderItemsLockedError,
  OrderNotFoundError,
  OrderNoteRequiredError,
  ShippingFeeRequiredError,
  StaleSettingsError,
  WarehouseNotFoundError,
} from '../domain/commerce.errors.js';
import {
  computeAmounts,
  datesBetween,
  localDate,
  nextDate,
  startOfLocalDay,
} from '@agent-sales/shared';
import { stockTransition } from '../domain/order-stock.js';
import {
  assertPolicy,
  assertStatusAllowed,
  loadOrderDto,
  loadSettings,
  normalizeSettings,
  orderLines,
  peopleOf,
} from './order-rules.js';
import {
  amountFields,
  orderSearchText,
  reservationChanges,
  stockChanges,
  STAFF_ORDER_ORIGIN,
  toSummary,
} from './order.mappers.js';
import {
  COMMERCE_STORE,
  type CommerceStore,
  type CommerceTx,
  type OrderRecord,
} from './ports/commerce-store.js';

const CLOSED: ReadonlySet<string> = new Set(CLOSED_ORDER_STATUSES);
const FULFILMENT: ReadonlySet<string> = new Set(FULFILMENT_ORDER_STATUSES);

/** Orders: creation with stock reservation, status flow, edits, list, overview (ORD-03/04/05/11). */
@Injectable()
export class OrderService {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(WORKSPACE_FACADE) private readonly workspaces: WorkspaceFacade,
  ) {}

  /**
   * Idempotent per `clientRequestId`: a retried or double-submitted draft returns
   * the order created the first time instead of a second one.
   */
  async create(ws: WorkspaceId, raw: CreateOrderRequest, actorUserId: string): Promise<OrderDto> {
    const input = CreateOrderSchema.parse(raw);
    try {
      return await this.#create(ws, input, actorUserId);
    } catch (error) {
      // Two identical drafts raced past the lookup; the loser returns the winner's order.
      if (!(error instanceof DuplicateOrderRequestError) || !input.clientRequestId) throw error;
      const requestId = input.clientRequestId;
      return this.store.run(ws, async (tx) => {
        const first = await tx.orders.findByRequestId(requestId);
        if (!first) throw error;
        return this.#dto(tx, first);
      });
    }
  }

  async #create(
    ws: WorkspaceId,
    input: ReturnType<typeof CreateOrderSchema.parse>,
    actorUserId: string,
  ): Promise<OrderDto> {
    const actorName = await this.identity.displayName(userId(actorUserId));
    return this.store.run(ws, async (tx) => {
      if (input.clientRequestId) {
        const first = await tx.orders.findByRequestId(input.clientRequestId);
        if (first) return this.#dto(tx, first);
      }
      const settings = await loadSettings(tx);
      assertStatusAllowed(settings, input.status);
      assertPolicy(settings, input.source, input, input.status);
      const warehouse = isUuid(input.warehouseId)
        ? await tx.warehouses.find(input.warehouseId)
        : null;
      if (!warehouse) {
        throw (await tx.warehouses.findDefault())
          ? new WarehouseNotFoundError(input.warehouseId)
          : new NoWarehouseError();
      }

      const items = await orderLines(tx, input.items);
      const amounts = computeAmounts({
        items: items.map((i) => ({ qty: i.qty, unitPrice: i.unitPrice, unitCost: i.unitCost })),
        discountType: input.discountType,
        discountValue: input.discountValue,
        shippingFee: input.shippingFee,
        shippingFeeCharged: input.shippingFeeCharged,
        freeShipping: input.freeShipping,
        surcharge: input.surcharge,
        transferAmount: input.transferAmount,
      });

      // A new order starts from "nothing held" and takes whatever its status needs.
      const stock = stockTransition('released', input.status);
      const now = new Date();
      const order: OrderRecord = {
        id: newId(),
        code: await tx.orders.nextCode(ws),
        status: input.status,
        stockState: stock.next,
        source: input.source,
        warehouseId: warehouse.id,
        customer: input.customer,
        recipient: input.recipient,
        expectedDeliveryAt: input.expectedDeliveryAt ? new Date(input.expectedDeliveryAt) : null,
        ...amountFields(amounts),
        carrier: input.carrier || null,
        trackingCode: input.trackingCode || null,
        noteInternal: input.noteInternal,
        notePrint: input.notePrint,
        createdByUserId: actorUserId,
        createdByName: actorName,
        clientRequestId: input.clientRequestId ?? null,
        ...STAFF_ORDER_ORIGIN,
        placedAt: input.placedAt ? new Date(input.placedAt) : now,
        confirmedAt: CLOSED.has(input.status) ? now : null,
        cancelledAt: input.status === 'cancelled' ? now : null,
        searchText: '',
        createdAt: now,
        updatedAt: now,
      };
      order.searchText = orderSearchText(order);
      await tx.orders.insert(order, items);
      await tx.inventory.apply(ws, stockChanges(stock.actions, order, items, actorUserId));
      await tx.orders.addHistory(ws, order.id, {
        fromStatus: null,
        toStatus: input.status,
        note: null,
        actorUserId,
        actorName,
        createdAt: now,
      });
      return this.#dto(tx, order);
    });
  }

  get(ws: WorkspaceId, id: string): Promise<OrderDto> {
    return this.store.run(ws, async (tx) => this.#dto(tx, await this.#order(tx, id)));
  }

  /**
   * Edits an order and recomputes its amounts. New lines (`items`) are accepted only
   * while the order holds its goods; the reservation moves by the difference, and
   * lines kept from before keep their price snapshot unless a new price is given.
   */
  update(
    ws: WorkspaceId,
    id: string,
    raw: UpdateOrderRequest,
    actorUserId: string | null = null,
  ): Promise<OrderDto> {
    const change = UpdateOrderSchema.parse(raw);
    return this.store.run(ws, async (tx) => {
      // Locked: concurrent edits and status changes of one order run one after the other.
      const o = await this.#order(tx, id, { forUpdate: true });
      const current = await tx.orders.itemsOf(o.id);
      let items = current;
      if (change.items) {
        if (o.stockState !== 'reserved') throw new OrderItemsLockedError(o.stockState);
        items = await orderLines(tx, change.items, current);
      }
      const next: OrderRecord = {
        ...o,
        // Merged, so fields the caller does not send (e.g. gender) are kept;
        // a blank value sent explicitly removes the field.
        ...(change.customer ? { customer: { ...o.customer, ...change.customer } } : {}),
        ...(change.recipient ? { recipient: { ...o.recipient, ...change.recipient } } : {}),
        ...(change.expectedDeliveryAt !== undefined
          ? {
              expectedDeliveryAt: change.expectedDeliveryAt
                ? new Date(change.expectedDeliveryAt)
                : null,
            }
          : {}),
        ...(change.carrier !== undefined ? { carrier: change.carrier || null } : {}),
        ...(change.trackingCode !== undefined ? { trackingCode: change.trackingCode || null } : {}),
        ...(change.noteInternal !== undefined ? { noteInternal: change.noteInternal } : {}),
        ...(change.notePrint !== undefined ? { notePrint: change.notePrint } : {}),
        updatedAt: new Date(),
      };
      if (change.customer || change.recipient) {
        // The edited people must still satisfy the policy of the stage the order is in.
        assertPolicy(await loadSettings(tx), o.source, peopleOf(next), o.status);
      }
      if (
        o.freeShipping &&
        change.freeShipping === false &&
        change.shippingFeeCharged === undefined
      ) {
        // The stored fee is 0 while shipping is free; the customer's fee must be given again.
        throw new ShippingFeeRequiredError();
      }
      const discountType = change.discountType ?? o.discountType;
      const discountValue = change.discountValue ?? o.discountValue;
      if (discountType === 'percent' && discountValue > 100) {
        throw new OrderDiscountError();
      }
      const amounts = computeAmounts({
        items: items.map((i) => ({ qty: i.qty, unitPrice: i.unitPrice, unitCost: i.unitCost })),
        discountType,
        discountValue,
        shippingFee: change.shippingFee ?? o.shippingFee,
        shippingFeeCharged: change.shippingFeeCharged ?? o.shippingFeeCharged,
        freeShipping: change.freeShipping ?? o.freeShipping,
        surcharge: change.surcharge ?? o.surcharge,
        transferAmount: change.transferAmount ?? o.transferAmount,
      });
      Object.assign(next, amountFields(amounts));
      next.searchText = orderSearchText(next);
      if (change.items) {
        await tx.inventory.apply(ws, reservationChanges(o, current, items, actorUserId));
        await tx.orders.replaceItems(o.id, items);
      }
      await tx.orders.update(next);
      return this.#dto(tx, next);
    });
  }

  async changeStatus(
    ws: WorkspaceId,
    id: string,
    input: ChangeOrderStatusRequest,
    actorUserId: string,
  ): Promise<OrderDto> {
    const actorName = await this.identity.displayName(userId(actorUserId));
    return this.store.run(ws, async (tx) => {
      // Locked: two people changing the same order cannot both move its stock.
      const o = await this.#order(tx, id, { forUpdate: true });
      if (o.status === input.status) return this.#dto(tx, o);
      const settings = await loadSettings(tx);
      assertStatusAllowed(settings, input.status);
      if (settings.requireNoteStatuses.includes(input.status) && !input.note?.trim()) {
        throw new OrderNoteRequiredError(input.status);
      }
      if (FULFILMENT.has(input.status) && !FULFILMENT.has(o.status)) {
        // Entering fulfilment: the source's confirmation fields must be filled by now.
        // Other moves (cancel, return, back to draft) never depend on the policy, so a
        // policy tightened after the order was saved cannot trap its stock.
        assertPolicy(settings, o.source, peopleOf(o), input.status, 'confirm');
      }

      const stock = stockTransition(o.stockState, input.status);
      const items = await tx.orders.itemsOf(o.id);
      const now = new Date();
      const next: OrderRecord = {
        ...o,
        status: input.status,
        stockState: stock.next,
        // First time the shop commits to the order; kept if it later moves on.
        confirmedAt: o.confirmedAt ?? (CLOSED.has(input.status) ? now : null),
        cancelledAt: input.status === 'cancelled' ? now : null,
        updatedAt: now,
      };
      await tx.inventory.apply(ws, stockChanges(stock.actions, o, items, actorUserId));
      await tx.orders.update(next);
      await tx.orders.addHistory(ws, o.id, {
        fromStatus: o.status,
        toStatus: input.status,
        note: input.note?.trim() || null,
        actorUserId,
        actorName,
        createdAt: now,
      });
      return this.#dto(tx, next);
    });
  }

  /** Takes the query as the controller's validation pipe parsed it. */
  async list(ws: WorkspaceId, q: z.output<typeof OrderListSchema>): Promise<OrderListResponse> {
    const tz = await this.#timezone(ws);
    return this.store.run(ws, async (tx) => {
      const result = await tx.orders.list({
        statuses: q.status,
        statusMode: q.statusMode,
        createdBy: q.createdBy,
        carrier: q.carrier,
        q: q.q ? foldVietnamese(q.q) : undefined,
        source: q.source,
        review: q.review,
        from: q.from ? startOfLocalDay(q.from, tz) : undefined,
        to: q.to ? startOfLocalDay(nextDate(q.to), tz) : undefined,
        sort: q.sort,
        offset: (q.page - 1) * q.pageSize,
        limit: q.pageSize,
      });
      return {
        data: result.rows.map((r) => toSummary(r, r.itemsPreview, r.itemCount)),
        total: result.total,
        page: q.page,
        pageSize: q.pageSize,
        counts: result.counts,
        totals: result.totals,
        facets: result.facets,
      };
    });
  }

  async overview(
    ws: WorkspaceId,
    range: { from: string; to: string },
  ): Promise<OrderOverviewResponse> {
    const tz = await this.#timezone(ws);
    const now = new Date();
    const today = localDate(now, tz);
    const [from, to] = range.from <= range.to ? [range.from, range.to] : [range.to, range.from];
    const agg = await this.store.run(ws, (tx) =>
      tx.orders.overview({
        from: startOfLocalDay(from, tz),
        to: startOfLocalDay(nextDate(to), tz),
        todayFrom: startOfLocalDay(today, tz),
        todayTo: startOfLocalDay(nextDate(today), tz),
        timezone: tz,
      }),
    );
    const byDate = new Map(agg.byDay.map((d) => [d.date, d]));
    const series = datesBetween(from, to).map(
      (date) =>
        byDate.get(date) ?? {
          date,
          sales: 0,
          revenue: 0,
          profit: 0,
          closedOrders: 0,
          productQty: 0,
        },
    );
    const sum = (k: 'sales' | 'revenue' | 'profit' | 'closedOrders' | 'productQty') =>
      series.reduce((n, d) => n + d[k], 0);
    const closedOrders = sum('closedOrders');
    const revenue = sum('revenue');
    const profit = sum('profit');
    const productQty = sum('productQty');
    return {
      from,
      to,
      timezone: tz,
      kpis: {
        sales: sum('sales'),
        revenue,
        profit,
        closedOrders,
        avgOrderValue: closedOrders ? Math.round(revenue / closedOrders) : 0,
        productQty,
        avgProductsPerOrder: closedOrders ? Math.round((productQty / closedOrders) * 10) / 10 : 0,
        avgProfitPerOrder: closedOrders ? Math.round(profit / closedOrders) : 0,
      },
      closed: { amount: revenue, productQty },
      returned: agg.returned,
      series,
      today: agg.today,
      generatedAt: now.toISOString(),
    };
  }

  getSettings(ws: WorkspaceId): Promise<OrderSettingsDto> {
    return this.store.run(ws, (tx) => loadSettings(tx));
  }

  /** Refused with CONFLICT when the settings changed since `s.version` was loaded. */
  putSettings(ws: WorkspaceId, raw: OrderSettingsDto): Promise<OrderSettingsDto> {
    const s = OrderSettingsSchema.parse(raw);
    return this.store.run(ws, async (tx) => {
      const clean = normalizeSettings(s);
      const version = await tx.settings.put(ws, { ...clean, version: s.version });
      if (version === null) throw new StaleSettingsError();
      return { ...clean, version };
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  async #timezone(ws: WorkspaceId): Promise<string> {
    return (await this.workspaces.getById(ws)).timezone || 'Asia/Ho_Chi_Minh';
  }

  async #order(tx: CommerceTx, id: string, opts?: { forUpdate: boolean }): Promise<OrderRecord> {
    const o = isUuid(id) ? await tx.orders.find(id, opts) : null;
    if (!o) throw new OrderNotFoundError(id);
    return o;
  }

  #dto(tx: CommerceTx, o: OrderRecord): Promise<OrderDto> {
    return loadOrderDto(tx, o);
  }
}
