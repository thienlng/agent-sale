import {
  type ChangeOrderStatusRequest,
  CLOSED_ORDER_STATUSES,
  CreateOrderRequest as CreateOrderSchema,
  type CreateOrderRequest,
  OPTIONAL_ORDER_STATUSES,
  type OrderDto,
  type OrderListQuery,
  OrderListQuery as OrderListSchema,
  type OrderListResponse,
  type OrderOverviewResponse,
  type OrderSettingsDto,
  type UpdateOrderRequest,
} from '@agent-sales/contracts';
import { foldVietnamese, isUuid, newId, userId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { CommerceFacade } from '../api/commerce.facade.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';
import { WORKSPACE_FACADE, type WorkspaceFacade } from '../../workspace/api/index.js';
import {
  DuplicateOrderRequestError,
  NoWarehouseError,
  OrderNotFoundError,
  OrderNoteRequiredError,
  StatusDisabledError,
  VariantNotFoundError,
  WarehouseNotFoundError,
} from '../domain/commerce.errors.js';
import { datesBetween, localDate, nextDate, startOfLocalDay } from '../domain/local-time.js';
import { computeAmounts } from '@agent-sales/shared';
import { type OrderStatus, stockTransition } from '../domain/order-stock.js';
import { orderSearchText, stockChanges, toOrderDto, toSummary } from './order.mappers.js';
import {
  COMMERCE_STORE,
  type CommerceStore,
  type CommerceTx,
  type OrderItemRecord,
  type OrderRecord,
} from './ports/commerce-store.js';

const CLOSED: ReadonlySet<string> = new Set(CLOSED_ORDER_STATUSES);
const OPTIONAL: ReadonlySet<string> = new Set(OPTIONAL_ORDER_STATUSES);
const DEFAULT_SETTINGS: OrderSettingsDto = {
  extraStatuses: ['awaiting_print', 'printed'],
  requireNoteStatuses: [],
};

/** Orders: creation with stock reservation, status flow, edits, list, overview (ORD-03/04/05/11). */
@Injectable()
export class OrderService implements CommerceFacade {
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
      const settings = await this.#settings(tx);
      this.#assertStatusAllowed(settings, input.status);
      const warehouse = isUuid(input.warehouseId)
        ? await tx.warehouses.find(input.warehouseId)
        : null;
      if (!warehouse) {
        throw (await tx.warehouses.findDefault())
          ? new WarehouseNotFoundError(input.warehouseId)
          : new NoWarehouseError();
      }

      const variantIds = [...new Set(input.items.map((i) => i.variantId))];
      const variants = new Map(
        (await tx.products.variantsByIds(variantIds))
          // Archived variants and products no longer on sale cannot be ordered.
          .filter((v) => !v.archived && v.productActive)
          .map((v) => [v.id, v]),
      );
      const missing = variantIds.filter((id) => !variants.has(id));
      if (missing.length) throw new VariantNotFoundError(missing);

      const items: OrderItemRecord[] = input.items.map((i, position) => {
        const v = variants.get(i.variantId);
        if (!v) throw new VariantNotFoundError([i.variantId]);
        const unitPrice = i.unitPrice ?? v.price;
        return {
          id: newId(),
          variantId: v.id,
          productName: v.productName,
          variantName: v.name,
          sku: v.sku,
          qty: i.qty,
          unitPrice,
          unitCost: v.cost,
          lineTotal: unitPrice * i.qty,
          position,
        };
      });
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
        itemQty: amounts.itemQty,
        subtotal: amounts.subtotal,
        discountType: amounts.discountType,
        discountValue: amounts.discountValue,
        discountAmount: amounts.discountAmount,
        shippingFee: amounts.shippingFee,
        shippingFeeCharged: amounts.shippingFeeCharged,
        freeShipping: amounts.freeShipping,
        surcharge: amounts.surcharge,
        transferAmount: amounts.transferAmount,
        total: amounts.total,
        paid: amounts.paid,
        remaining: amounts.remaining,
        codAmount: amounts.cod,
        costTotal: amounts.costTotal,
        carrier: input.carrier || null,
        trackingCode: input.trackingCode || null,
        noteInternal: input.noteInternal,
        notePrint: input.notePrint,
        createdByUserId: actorUserId,
        createdByName: actorName,
        clientRequestId: input.clientRequestId ?? null,
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

  getOrder(ws: WorkspaceId, id: string): Promise<OrderDto> {
    return this.get(ws, id);
  }

  get(ws: WorkspaceId, id: string): Promise<OrderDto> {
    return this.store.run(ws, async (tx) => this.#dto(tx, await this.#order(tx, id)));
  }

  /** Edits that keep the items; payment and shipping changes recompute the amounts. */
  update(ws: WorkspaceId, id: string, change: UpdateOrderRequest): Promise<OrderDto> {
    return this.store.run(ws, async (tx) => {
      const o = await this.#order(tx, id, { forUpdate: true });
      const items = await tx.orders.itemsOf(o.id);
      const next: OrderRecord = {
        ...o,
        ...(change.customer ? { customer: change.customer } : {}),
        ...(change.recipient ? { recipient: change.recipient } : {}),
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
      const amounts = computeAmounts({
        items: items.map((i) => ({ qty: i.qty, unitPrice: i.unitPrice, unitCost: i.unitCost })),
        discountType: o.discountType,
        discountValue: o.discountValue,
        shippingFee: change.shippingFee ?? o.shippingFee,
        shippingFeeCharged: o.shippingFeeCharged,
        freeShipping: o.freeShipping,
        surcharge: o.surcharge,
        transferAmount: change.transferAmount ?? o.transferAmount,
      });
      Object.assign(next, {
        shippingFee: amounts.shippingFee,
        transferAmount: amounts.transferAmount,
        total: amounts.total,
        paid: amounts.paid,
        remaining: amounts.remaining,
        codAmount: amounts.cod,
      });
      next.searchText = orderSearchText(next);
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
      const settings = await this.#settings(tx);
      this.#assertStatusAllowed(settings, input.status);
      if (settings.requireNoteStatuses.includes(input.status) && !input.note?.trim()) {
        throw new OrderNoteRequiredError(input.status);
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

  async list(ws: WorkspaceId, raw: OrderListQuery): Promise<OrderListResponse> {
    const q = OrderListSchema.parse(raw);
    const tz = await this.#timezone(ws);
    return this.store.run(ws, async (tx) => {
      const result = await tx.orders.list({
        status: q.status,
        q: q.q ? foldVietnamese(q.q) : undefined,
        source: q.source,
        from: q.from ? startOfLocalDay(q.from, tz) : undefined,
        to: q.to ? startOfLocalDay(nextDate(q.to), tz) : undefined,
        sort: q.sort,
        offset: (q.page - 1) * q.pageSize,
        limit: q.pageSize,
      });
      return {
        data: result.rows.map((r) => toSummary(r, r.itemsPreview)),
        total: result.total,
        page: q.page,
        pageSize: q.pageSize,
        counts: result.counts,
        totals: result.totals,
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
    return this.store.run(ws, (tx) => this.#settings(tx));
  }

  putSettings(ws: WorkspaceId, s: OrderSettingsDto): Promise<OrderSettingsDto> {
    return this.store.run(ws, async (tx) => {
      const clean: OrderSettingsDto = {
        extraStatuses: [...new Set(s.extraStatuses)],
        requireNoteStatuses: [...new Set(s.requireNoteStatuses)],
      };
      await tx.settings.put(ws, clean);
      return clean;
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  async #timezone(ws: WorkspaceId): Promise<string> {
    return (await this.workspaces.getById(ws)).timezone || 'Asia/Ho_Chi_Minh';
  }

  async #settings(tx: CommerceTx): Promise<OrderSettingsDto> {
    const s = await tx.settings.get();
    return s ? (s as OrderSettingsDto) : DEFAULT_SETTINGS;
  }

  #assertStatusAllowed(settings: OrderSettingsDto, status: OrderStatus): void {
    if (OPTIONAL.has(status) && !(settings.extraStatuses as string[]).includes(status)) {
      throw new StatusDisabledError(status);
    }
  }

  async #order(tx: CommerceTx, id: string, opts?: { forUpdate: boolean }): Promise<OrderRecord> {
    const o = isUuid(id) ? await tx.orders.find(id, opts) : null;
    if (!o) throw new OrderNotFoundError(id);
    return o;
  }

  async #dto(tx: CommerceTx, o: OrderRecord): Promise<OrderDto> {
    const [items, history, warehouse] = await Promise.all([
      tx.orders.itemsOf(o.id),
      tx.orders.historyOf(o.id),
      tx.warehouses.find(o.warehouseId),
    ]);
    return toOrderDto(o, items, history, warehouse?.name ?? '');
  }
}
