import type { WorkspaceId } from '@agent-sales/shared';

import type {
  BotOrderDraftRecord,
  CommerceStore,
  CommerceTx,
  HistoryRecord,
  OrderItemRecord,
  OrderListFilter,
  OrderRecord,
  ProductRecord,
  StockChange,
  StockRecord,
  VariantRecord,
  WarehouseRecord,
} from '../../application/ports/commerce-store.js';
import { DuplicateOrderRequestError } from '../../domain/commerce.errors.js';

const clone = <T>(x: T): T => structuredClone(x);

/**
 * In-memory twin of the commerce store for the parts the bot order flow uses (one workspace).
 * A use case that throws rolls back: the state is restored from a snapshot.
 */
export class InMemoryCommerce implements CommerceStore {
  warehouses: WarehouseRecord[] = [];
  products: ProductRecord[] = [];
  variants: VariantRecord[] = [];
  botSelection = new Map<string, string[]>();
  stock: StockRecord[] = [];
  movements: StockChange[] = [];
  orders: OrderRecord[] = [];
  items = new Map<string, OrderItemRecord[]>();
  history = new Map<string, HistoryRecord[]>();
  drafts = new Map<string, BotOrderDraftRecord>();
  lastListFilter: OrderListFilter | null = null;
  codeCounter = 0;

  async run<T>(_ws: WorkspaceId, fn: (tx: CommerceTx) => Promise<T>): Promise<T> {
    const snapshot = clone({
      stock: this.stock,
      movements: this.movements,
      orders: this.orders,
      items: this.items,
      history: this.history,
      drafts: this.drafts,
      codeCounter: this.codeCounter,
    });
    try {
      return await fn(this.#tx());
    } catch (error) {
      Object.assign(this, snapshot);
      throw error;
    }
  }

  #botVisible(selectedFor: string | undefined) {
    const chosen = selectedFor ? (this.botSelection.get(selectedFor) ?? []) : null;
    return this.products.filter(
      (p) => p.status === 'active' && p.visibleToBot && (!chosen || chosen.includes(p.id)),
    );
  }

  #withProduct(v: VariantRecord) {
    const p = this.products.find((x) => x.id === v.productId);
    return {
      ...v,
      productName: p?.name ?? '',
      productCode: p?.code ?? '',
      productActive: p?.status === 'active',
      productVisibleToBot: p?.visibleToBot ?? false,
    };
  }

  #tx(): CommerceTx {
    const tx = {
      warehouses: {
        find: async (id: string) => this.warehouses.find((w) => w.id === id) ?? null,
        findDefault: async () => this.warehouses.find((w) => w.isDefault) ?? null,
      },
      products: {
        findForBot: async (ids: string[], selectedFor?: string) =>
          this.#botVisible(selectedFor).filter((p) => ids.includes(p.id)),
        variantsByIds: async (ids: string[]) =>
          this.variants.filter((v) => ids.includes(v.id)).map((v) => this.#withProduct(v)),
      },
      botProducts: {
        list: async (botId: string) => [...(this.botSelection.get(botId) ?? [])],
      },
      inventory: {
        stockOf: async (ids: string[]) => this.stock.filter((s) => ids.includes(s.variantId)),
        lockStock: async (variantId: string, warehouseId: string) =>
          this.stock.find((s) => s.variantId === variantId && s.warehouseId === warehouseId) ??
          null,
        apply: async (_ws: WorkspaceId, changes: StockChange[]) => {
          for (const c of changes) {
            let row = this.stock.find(
              (s) => s.variantId === c.variantId && s.warehouseId === c.warehouseId,
            );
            if (!row) {
              row = { variantId: c.variantId, warehouseId: c.warehouseId, onHand: 0, reserved: 0 };
              this.stock.push(row);
            }
            row.onHand += c.onHandDelta;
            row.reserved += c.reservedDelta;
            this.movements.push(c);
          }
        },
      },
      orders: {
        nextCode: async () => `DH${String(++this.codeCounter).padStart(6, '0')}`,
        insert: async (o: OrderRecord, items: OrderItemRecord[]) => {
          if (o.clientRequestId && this.orders.some((x) => x.clientRequestId === o.clientRequestId))
            throw new DuplicateOrderRequestError();
          this.orders.push(clone(o));
          this.items.set(o.id, clone(items));
        },
        find: async (id: string) => clone(this.orders.find((o) => o.id === id) ?? null),
        findByRequestId: async (rid: string) =>
          clone(this.orders.find((o) => o.clientRequestId === rid) ?? null),
        itemsOf: async (id: string) => clone(this.items.get(id) ?? []),
        itemImages: async (id: string) => {
          const urls = new Map<string, string>();
          for (const i of this.items.get(id) ?? []) {
            const v = this.variants.find((x) => x.id === i.variantId);
            const url = this.products.find((p) => p.id === v?.productId)?.imageUrls[0];
            if (url) urls.set(i.variantId, url);
          }
          return urls;
        },
        historyOf: async (id: string) => clone(this.history.get(id) ?? []),
        update: async (o: OrderRecord) => {
          this.orders = this.orders.map((x) => (x.id === o.id ? clone(o) : x));
        },
        addHistory: async (_ws: WorkspaceId, id: string, h: HistoryRecord) => {
          this.history.set(id, [...(this.history.get(id) ?? []), h]);
        },
        list: async (f: OrderListFilter) => {
          this.lastListFilter = f;
          const rows = this.orders.filter(
            (o) => !f.review || (o.reviewState === 'pending' && o.status !== 'cancelled'),
          );
          return {
            rows: rows.map((o) => ({ ...o, itemsPreview: [] })),
            total: rows.length,
            counts: {},
            totals: { itemQty: 0, shippingFeeCharged: 0, cod: 0, gross: 0, total: 0 },
            facets: { creators: [], carriers: [] },
          };
        },
        countPendingReview: async () =>
          this.orders.filter((o) => o.reviewState === 'pending' && o.status !== 'cancelled').length,
      },
      settings: { get: async () => null },
      botOrders: {
        variantsBySkus: async (skus: string[]) => {
          const wanted = skus.map((s) => s.trim().toLowerCase());
          return this.variants
            .filter((v) => wanted.includes(v.sku.toLowerCase()))
            .sort((a, b) => Number(a.archived) - Number(b.archived))
            .map((v) => this.#withProduct(v));
        },
        findDraft: async (id: string) => clone(this.drafts.get(id) ?? null),
        saveDraft: async (_ws: WorkspaceId, d: BotOrderDraftRecord) => {
          this.drafts.set(d.conversationId, clone(d));
        },
        deleteDraft: async (id: string, storedAt?: Date) => {
          const d = this.drafts.get(id);
          if (!d || (storedAt && d.createdAt.getTime() !== storedAt.getTime())) return false;
          return this.drafts.delete(id);
        },
        sweepExpired: async (now: Date) => {
          for (const [id, d] of this.drafts) if (d.expiresAt < now) this.drafts.delete(id);
        },
      },
    };
    // Only the members the bot order flow touches are implemented.
    return tx as unknown as CommerceTx;
  }
}
