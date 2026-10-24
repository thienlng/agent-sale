import { z } from 'zod';

/** Money: integer VND (docs/05 conventions). */
export const Money = z.number().int().min(0).max(1_000_000_000_000);

// ─── Order statuses (docs/02 ORD-05) ──────────────────────────────────────────

export const OrderStatus = z.enum([
  'new',
  'awaiting_confirmation',
  'ordered',
  'confirmed',
  'packing',
  'awaiting_print',
  'printed',
  'awaiting_handover',
  'delivering',
  'delivered',
  'delivery_failed',
  'returning',
  'returned',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof OrderStatus>;

/** Statuses a workspace may switch on or off in order settings ("trạng thái bổ sung"). */
export const OPTIONAL_ORDER_STATUSES = [
  'awaiting_print',
  'printed',
] as const satisfies readonly OrderStatus[];

/** "Đơn chốt": orders the shop has committed to; revenue and profit count only these. */
export const CLOSED_ORDER_STATUSES = [
  'confirmed',
  'packing',
  'awaiting_print',
  'printed',
  'awaiting_handover',
  'delivering',
  'delivered',
] as const satisfies readonly OrderStatus[];

/** Goods have left the warehouse in these statuses (stock is deducted on entering one). */
export const SHIPPED_ORDER_STATUSES = [
  'delivering',
  'delivered',
  'delivery_failed',
  'returning',
] as const satisfies readonly OrderStatus[];

export const OrderSource = z.enum([
  'hotline',
  'facebook',
  'instagram',
  'zalo',
  'tiktok',
  'shopee',
  'website',
  'store',
  'other',
]);
export type OrderSource = z.infer<typeof OrderSource>;

// ─── Warehouses (ORD-02) ──────────────────────────────────────────────────────

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null)
    .nullable()
    .optional();

export const WarehouseDto = z.object({
  id: z.uuid(),
  name: z.string(),
  phone: z.string().nullable(),
  province: z.string().nullable(),
  ward: z.string().nullable(),
  addressDetail: z.string().nullable(),
  isDefault: z.boolean(),
});
export type WarehouseDto = z.infer<typeof WarehouseDto>;

export const UpsertWarehouseRequest = z.object({
  name: z.string().trim().min(1).max(120),
  phone: optionalText(32),
  province: optionalText(120),
  ward: optionalText(120),
  addressDetail: optionalText(300),
  isDefault: z.boolean().optional(),
});
export type UpsertWarehouseRequest = z.input<typeof UpsertWarehouseRequest>;

export const WarehouseList = z.object({ data: z.array(WarehouseDto) });

// ─── Products and variants (ORD-01) ───────────────────────────────────────────

export const VariantStock = z.object({
  warehouseId: z.uuid(),
  onHand: z.number().int(),
  reserved: z.number().int(),
  /** onHand − reserved: what new orders can still take. */
  available: z.number().int(),
});

export const ProductVariantDto = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  price: Money,
  cost: Money,
  weightGram: z.number().int(),
  stock: z.array(VariantStock),
});
export type ProductVariantDto = z.infer<typeof ProductVariantDto>;

export const ProductDto = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  visibleToBot: z.boolean(),
  variants: z.array(ProductVariantDto),
  priceMin: Money,
  priceMax: Money,
  /** Σ available over variants and warehouses. */
  available: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProductDto = z.infer<typeof ProductDto>;

const Code = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[\p{L}\p{N}._\-/]+$/u, 'letters, digits and . _ - / only');

export const ProductVariantInput = z.object({
  /** Present for an existing variant; omitted to add one. Variants left out are archived. */
  id: z.uuid().optional(),
  sku: Code,
  name: z.string().trim().max(120).default(''),
  price: Money,
  cost: Money.default(0),
  weightGram: z.number().int().min(0).max(1_000_000).default(0),
});
export type ProductVariantInput = z.input<typeof ProductVariantInput>;

export const UpsertProductRequest = z
  .object({
    code: Code,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(5000).default(''),
    category: optionalText(120),
    visibleToBot: z.boolean().default(true),
    status: z.enum(['active', 'archived']).default('active'),
    variants: z.array(ProductVariantInput).min(1).max(100),
  })
  .refine((p) => new Set(p.variants.map((v) => v.sku.toLowerCase())).size === p.variants.length, {
    message: 'each variant needs a different SKU',
    path: ['variants'],
  });
export type UpsertProductRequest = z.input<typeof UpsertProductRequest>;

export const ProductListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'archived']).default('active'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

/** Page-number pagination: the catalog and order screens show totals and page jumps (ORD-04). */
export const ProductListResponse = z.object({
  data: z.array(ProductDto),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ProductListResponse = z.infer<typeof ProductListResponse>;

/** Sets the counted quantity of one variant in one warehouse (a stock-take adjustment). */
export const AdjustStockRequest = z.object({
  variantId: z.uuid(),
  warehouseId: z.uuid(),
  onHand: z.number().int().min(0).max(10_000_000),
});
export type AdjustStockRequest = z.infer<typeof AdjustStockRequest>;

/** The order form's product picker. */
export const VariantSearchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  warehouseId: z.uuid(),
  inStock: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export const VariantOption = z.object({
  variantId: z.uuid(),
  productId: z.uuid(),
  productCode: z.string(),
  productName: z.string(),
  variantName: z.string(),
  sku: z.string(),
  price: Money,
  available: z.number().int(),
});
export type VariantOption = z.infer<typeof VariantOption>;
export const VariantSearchResponse = z.object({ data: z.array(VariantOption) });

// ─── Orders (ORD-03, ORD-04) ──────────────────────────────────────────────────

const Phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 .-]{8,15}$/, 'invalid phone number');

export const OrderCustomer = z.object({
  name: z.string().trim().min(1).max(120),
  phone: Phone,
  email: z
    .email()
    .max(254)
    .optional()
    .or(z.literal('').transform(() => undefined)),
  gender: z.enum(['male', 'female', 'other']).optional(),
});
export type OrderCustomer = z.infer<typeof OrderCustomer>;

export const OrderRecipient = z.object({
  name: z.string().trim().min(1).max(120),
  phone: Phone,
  address: z.string().trim().min(1).max(300),
  province: z.string().trim().max(120).optional(),
  ward: z.string().trim().max(120).optional(),
});
export type OrderRecipient = z.infer<typeof OrderRecipient>;

export const DiscountType = z.enum(['amount', 'percent']);

export const CreateOrderRequest = z
  .object({
    source: OrderSource,
    warehouseId: z.uuid(),
    status: OrderStatus.default('new'),
    placedAt: z.iso.datetime().optional(),
    customer: OrderCustomer,
    /** Defaults to the customer (same person, address required). */
    recipient: OrderRecipient,
    expectedDeliveryAt: z.iso.datetime().optional(),
    items: z
      .array(
        z.object({
          variantId: z.uuid(),
          qty: z.number().int().min(1).max(10_000),
          /** Overrides the variant price for this order; defaults to it. */
          unitPrice: Money.optional(),
        }),
      )
      .min(1)
      .max(200),
    discountType: DiscountType.default('amount'),
    discountValue: Money.default(0),
    /** What the carrier charges the shop. */
    shippingFee: Money.default(0),
    /** What the customer pays for shipping; forced to 0 by freeShipping. */
    shippingFeeCharged: Money.default(0),
    freeShipping: z.boolean().default(false),
    surcharge: Money.default(0),
    transferAmount: Money.default(0),
    carrier: z.string().trim().max(60).optional(),
    trackingCode: z.string().trim().max(60).optional(),
    noteInternal: z.string().trim().max(2000).default(''),
    notePrint: z.string().trim().max(2000).default(''),
  })
  .refine((o) => o.discountType !== 'percent' || o.discountValue <= 100, {
    message: 'a percentage discount is at most 100',
    path: ['discountValue'],
  });
export type CreateOrderRequest = z.input<typeof CreateOrderRequest>;

/** Edits that keep the items: people, shipping, payment received, notes. */
export const UpdateOrderRequest = z.object({
  customer: OrderCustomer.optional(),
  recipient: OrderRecipient.optional(),
  expectedDeliveryAt: z.iso.datetime().nullable().optional(),
  carrier: z.string().trim().max(60).nullable().optional(),
  trackingCode: z.string().trim().max(60).nullable().optional(),
  shippingFee: Money.optional(),
  transferAmount: Money.optional(),
  noteInternal: z.string().trim().max(2000).optional(),
  notePrint: z.string().trim().max(2000).optional(),
});
export type UpdateOrderRequest = z.infer<typeof UpdateOrderRequest>;

export const ChangeOrderStatusRequest = z.object({
  status: OrderStatus,
  note: z.string().trim().max(1000).optional(),
});
export type ChangeOrderStatusRequest = z.infer<typeof ChangeOrderStatusRequest>;

export const OrderAmounts = z.object({
  itemQty: z.number().int(),
  subtotal: Money,
  discountType: DiscountType,
  discountValue: Money,
  discountAmount: Money,
  afterDiscount: Money,
  shippingFee: Money,
  shippingFeeCharged: Money,
  freeShipping: z.boolean(),
  surcharge: Money,
  /** "Tổng số tiền" / "Tiền cần thu". */
  total: Money,
  transferAmount: Money,
  paid: Money,
  /** "Còn thiếu": negative when the customer overpaid. */
  remaining: z.number().int(),
  cod: Money,
});
export type OrderAmounts = z.infer<typeof OrderAmounts>;

export const OrderItemDto = z.object({
  id: z.uuid(),
  variantId: z.uuid(),
  productName: z.string(),
  variantName: z.string(),
  sku: z.string(),
  qty: z.number().int(),
  unitPrice: Money,
  lineTotal: Money,
});

export const OrderHistoryEntry = z.object({
  fromStatus: OrderStatus.nullable(),
  toStatus: OrderStatus,
  note: z.string().nullable(),
  actorName: z.string().nullable(),
  at: z.iso.datetime(),
});

export const OrderSummaryDto = z.object({
  id: z.uuid(),
  code: z.string(),
  status: OrderStatus,
  source: OrderSource,
  customer: OrderCustomer,
  recipient: OrderRecipient,
  carrier: z.string().nullable(),
  trackingCode: z.string().nullable(),
  noteInternal: z.string(),
  amounts: OrderAmounts,
  /** First items, for the list's product column. */
  itemsPreview: z.array(z.object({ name: z.string(), qty: z.number().int() })),
  createdByName: z.string().nullable(),
  placedAt: z.iso.datetime(),
});
export type OrderSummaryDto = z.infer<typeof OrderSummaryDto>;

export const OrderDto = OrderSummaryDto.extend({
  warehouseId: z.uuid(),
  warehouseName: z.string(),
  expectedDeliveryAt: z.iso.datetime().nullable(),
  notePrint: z.string(),
  items: z.array(OrderItemDto),
  history: z.array(OrderHistoryEntry),
  stockState: z.enum(['reserved', 'shipped', 'released', 'returned']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OrderDto = z.infer<typeof OrderDto>;

export const OrderListQuery = z.object({
  status: OrderStatus.optional(),
  /** Order code, tracking code, customer/recipient name, phone, address, notes (accent-insensitive). */
  q: z.string().trim().max(100).optional(),
  source: OrderSource.optional(),
  /** Inclusive local dates (workspace time zone), yyyy-mm-dd. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sort: z.enum(['placed_desc', 'placed_asc', 'total_desc', 'total_asc']).default('placed_desc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type OrderListQuery = z.input<typeof OrderListQuery>;

export const OrderListResponse = z.object({
  data: z.array(OrderSummaryDto),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Per status (and `all`) for the tabs, under the same search/date/source filter. */
  counts: z.record(z.string(), z.number().int()),
  /** Footer totals over every matching order, not only this page. */
  totals: z.object({
    itemQty: z.number().int(),
    shippingFeeCharged: Money,
    cod: Money,
    total: Money,
  }),
});
export type OrderListResponse = z.infer<typeof OrderListResponse>;

export const OrderSettingsDto = z.object({
  extraStatuses: z.array(z.enum(OPTIONAL_ORDER_STATUSES)),
  /** Changing an order into one of these requires a note. */
  requireNoteStatuses: z.array(OrderStatus),
});
export type OrderSettingsDto = z.infer<typeof OrderSettingsDto>;

// ─── Overview (ORD-11) ────────────────────────────────────────────────────────

export const OrderOverviewQuery = z.object({ from: z.iso.date(), to: z.iso.date() });

const Kpis = z.object({
  /** "Doanh số": Σ total of every order except cancelled ones. */
  sales: Money,
  /** "Doanh thu": Σ total of closed orders. */
  revenue: Money,
  /** Σ over closed orders of (goods − cost − discount − shipping the shop absorbed); may be negative. */
  profit: z.number().int(),
  closedOrders: z.number().int(),
  avgOrderValue: Money,
  productQty: z.number().int(),
  avgProductsPerOrder: z.number(),
  avgProfitPerOrder: z.number().int(),
});

export const OrderOverviewResponse = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  timezone: z.string(),
  kpis: Kpis,
  closed: z.object({ amount: Money, productQty: z.number().int() }),
  returned: z.object({ amount: Money, productQty: z.number().int() }),
  series: z.array(
    z.object({
      date: z.iso.date(),
      sales: Money,
      revenue: Money,
      profit: z.number().int(),
      closedOrders: z.number().int(),
      productQty: z.number().int(),
    }),
  ),
  today: z.object({
    revenue: Money,
    closedOrders: z.number().int(),
    created: z.number().int(),
    cancelled: z.number().int(),
    productQty: z.number().int(),
    byHour: z.array(z.object({ hour: z.number().int(), revenue: Money })),
  }),
  generatedAt: z.iso.datetime(),
});
export type OrderOverviewResponse = z.infer<typeof OrderOverviewResponse>;
