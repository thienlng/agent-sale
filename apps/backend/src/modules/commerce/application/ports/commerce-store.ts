import type { WorkspaceId } from '@agent-sales/shared';

import type { OrderStatus, StockState } from '../../domain/order-stock.js';

/** Plain records the commerce use cases work with. Money is integer VND. */
export interface WarehouseRecord {
  id: string;
  name: string;
  phone: string | null;
  province: string | null;
  ward: string | null;
  addressDetail: string | null;
  isDefault: boolean;
}

export interface VariantRecord {
  id: string;
  productId: string;
  sku: string;
  name: string;
  price: number;
  cost: number;
  weightGram: number;
  position: number;
  archived: boolean;
}

export interface ProductRecord {
  id: string;
  code: string;
  name: string;
  description: string;
  category: string | null;
  status: 'active' | 'archived';
  visibleToBot: boolean;
  botInstructions: string;
  imageUrls: string[];
  searchText: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StockRecord {
  variantId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
}

export type MovementReason = 'adjust' | 'reserve' | 'release' | 'ship' | 'return';

export interface StockChange {
  variantId: string;
  warehouseId: string;
  onHandDelta: number;
  reservedDelta: number;
  reason: MovementReason;
  refType: 'order' | 'stocktake';
  refId: string | null;
  actorUserId: string | null;
}

export interface OrderItemRecord {
  id: string;
  variantId: string;
  productName: string;
  variantName: string;
  sku: string;
  qty: number;
  unitPrice: number;
  unitCost: number;
  lineTotal: number;
  position: number;
}

export interface OrderRecord {
  id: string;
  code: string;
  status: OrderStatus;
  stockState: StockState;
  source: string;
  warehouseId: string;
  customer: Record<string, unknown>;
  recipient: Record<string, unknown>;
  expectedDeliveryAt: Date | null;
  itemQty: number;
  subtotal: number;
  discountType: 'amount' | 'percent';
  discountValue: number;
  discountAmount: number;
  shippingFee: number;
  shippingFeeCharged: number;
  freeShipping: boolean;
  surcharge: number;
  transferAmount: number;
  total: number;
  paid: number;
  remaining: number;
  codAmount: number;
  costTotal: number;
  carrier: string | null;
  trackingCode: string | null;
  noteInternal: string;
  notePrint: string;
  createdByUserId: string | null;
  createdByName: string | null;
  clientRequestId: string | null;
  placedAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  searchText: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HistoryRecord {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  note: string | null;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: Date;
}

export interface OrderListFilter {
  statuses?: OrderStatus[] | undefined;
  /** `exclude`: status NOT IN `statuses`. */
  statusMode: 'include' | 'exclude';
  createdBy?: string | undefined;
  carrier?: string | undefined;
  /** Folded search text. */
  q?: string | undefined;
  source?: string | undefined;
  /** Half-open UTC range [from, to). */
  from?: Date | undefined;
  to?: Date | undefined;
  sort: 'placed_desc' | 'placed_asc' | 'total_desc' | 'total_asc';
  offset: number;
  limit: number;
}

export interface OrderListResult {
  rows: Array<OrderRecord & { itemsPreview: Array<{ name: string; qty: number }> }>;
  total: number;
  counts: Record<string, number>;
  totals: {
    itemQty: number;
    shippingFeeCharged: number;
    cod: number;
    gross: number;
    total: number;
  };
  facets: { creators: Array<{ id: string; name: string }>; carriers: string[] };
}

export interface SourcePolicyRecord {
  source: string;
  create: string[];
  confirm: string[];
}

export interface OrderSettingsRecord {
  extraStatuses: string[];
  requireNoteStatuses: string[];
  policies: SourcePolicyRecord[];
  version: number;
}

/** Aggregates for the overview, bucketed in the workspace time zone. */
export interface OverviewAggregates {
  byDay: Array<{
    date: string;
    sales: number;
    revenue: number;
    profit: number;
    closedOrders: number;
    productQty: number;
  }>;
  returned: { amount: number; productQty: number };
  today: {
    revenue: number;
    closedOrders: number;
    created: number;
    cancelled: number;
    productQty: number;
    byHour: Array<{ hour: number; revenue: number }>;
  };
}

/** Everything one use case reads and writes, inside one tenant transaction (RLS-scoped). */
export interface CommerceTx {
  warehouses: {
    list(): Promise<WarehouseRecord[]>;
    find(id: string): Promise<WarehouseRecord | null>;
    findDefault(): Promise<WarehouseRecord | null>;
    insert(w: WarehouseRecord): Promise<void>;
    update(w: WarehouseRecord): Promise<void>;
    clearDefault(): Promise<void>;
    softDelete(id: string): Promise<void>;
    hasStock(id: string): Promise<boolean>;
    hasOrders(id: string): Promise<boolean>;
  };
  products: {
    list(filter: {
      q?: string | undefined;
      status: string;
      /** Only the products selected for this bot. */
      selectedFor?: string | undefined;
      offset: number;
      limit: number;
    }): Promise<{
      rows: ProductRecord[];
      total: number;
    }>;
    find(id: string): Promise<ProductRecord | null>;
    /** Throws DuplicateCodeError on a code clash. */
    save(p: ProductRecord): Promise<void>;
    variantsOf(productIds: string[]): Promise<VariantRecord[]>;
    /** Insert or update; throws DuplicateCodeError('sku') on an SKU clash. */
    saveVariants(workspaceId: WorkspaceId, variants: VariantRecord[]): Promise<void>;
    archiveVariants(ids: string[]): Promise<void>;
    variantsByIds(
      ids: string[],
    ): Promise<
      Array<VariantRecord & { productName: string; productCode: string; productActive: boolean }>
    >;
    searchVariants(filter: {
      q?: string | undefined;
      warehouseId: string;
      inStock: boolean;
      limit: number;
    }): Promise<
      Array<
        VariantRecord & {
          productName: string;
          productCode: string;
          onHand: number;
          reserved: number;
        }
      >
    >;
  };
  /** Products selected for a bot (bot_products). */
  botProducts: {
    list(botId: string): Promise<string[]>;
    /**
     * Replaces the selection. Throws BotNotFoundError or ProductNotFoundError when the bot or a
     * product is not in the workspace.
     */
    replace(workspaceId: WorkspaceId, botId: string, productIds: string[]): Promise<void>;
    /** Adds one product to the selection; already selected is a no-op. Same errors as replace. */
    add(workspaceId: WorkspaceId, botId: string, productId: string): Promise<void>;
  };
  inventory: {
    stockOf(variantIds: string[]): Promise<StockRecord[]>;
    /** Reads one stock row and locks it until the transaction ends (stock-takes). */
    lockStock(variantId: string, warehouseId: string): Promise<StockRecord | null>;
    /** Applies the deltas and appends one movement per change. */
    apply(workspaceId: WorkspaceId, changes: StockChange[]): Promise<void>;
  };
  orders: {
    nextCode(workspaceId: WorkspaceId): Promise<string>;
    insert(o: OrderRecord, items: OrderItemRecord[]): Promise<void>;
    find(id: string, opts?: { forUpdate?: boolean }): Promise<OrderRecord | null>;
    findByRequestId(requestId: string): Promise<OrderRecord | null>;
    itemsOf(orderId: string): Promise<OrderItemRecord[]>;
    historyOf(orderId: string): Promise<HistoryRecord[]>;
    update(o: OrderRecord): Promise<void>;
    /** Replaces every line of an order. */
    replaceItems(orderId: string, items: OrderItemRecord[]): Promise<void>;
    addHistory(workspaceId: WorkspaceId, orderId: string, h: HistoryRecord): Promise<void>;
    list(filter: OrderListFilter): Promise<OrderListResult>;
    overview(range: {
      from: Date;
      to: Date;
      todayFrom: Date;
      todayTo: Date;
      timezone: string;
    }): Promise<OverviewAggregates>;
  };
  settings: {
    get(): Promise<OrderSettingsRecord | null>;
    /**
     * Saves when the stored version is still `s.version` (0 = never saved) and
     * returns the new version; returns null when someone saved in between.
     */
    put(workspaceId: WorkspaceId, s: OrderSettingsRecord): Promise<number | null>;
  };
}

export interface CommerceStore {
  run<T>(workspaceId: WorkspaceId, fn: (tx: CommerceTx) => Promise<T>): Promise<T>;
}

export const COMMERCE_STORE = Symbol('COMMERCE_STORE');
