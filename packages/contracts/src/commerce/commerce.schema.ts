import { z } from 'zod';
import { PublicImageUrl } from '../common/media.js';
import { AccommodationDetails, CatalogAccommodationDetails } from './lodging.schema.js';
import { Money } from './money.schema.js';
import { OrderItemsPreviewFields, OrderOriginFields } from './order-review.schema.js';

export { Money } from './money.schema.js';

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

/**
 * Customer-facing product pictures: Rapiz `/media/…` paths (older rows: https URLs). The bot
 * sends them in chats as absolute URLs on the current public base.
 * The API additionally requires a URL returned by POST /products/images for the same workspace.
 */
export const MAX_PRODUCT_IMAGES = 5;
export const ProductImageUrl = PublicImageUrl;
export const ProductImageUrls = z.array(ProductImageUrl).max(MAX_PRODUCT_IMAGES);

/**
 * A course (education) or a service (spa, salon) sold as a product (spec ESV §4.2). A product
 * with an offering has no stock: the bot sees its facts, never "in stock" or "out of stock".
 */
export const OfferingDetails = z.object({
  kind: z.enum(['course', 'service']),
  /** One appointment (service) or one session (course), in minutes. */
  durationMinutes: z.number().int().min(5).max(1440).nullable().default(null),
  /** Sessions in a course or a treatment package ("liệu trình 10 buổi"). */
  sessions: z.number().int().min(1).max(1000).nullable().default(null),
  /** How long the whole course runs, as the business says it ("3 tháng"). */
  period: z.string().trim().max(60).default(''),
  format: z.enum(['online', 'offline', 'hybrid']).nullable().default(null),
  level: z.string().trim().max(120).default(''),
  schedule: z.string().trim().max(500).default(''),
  audience: z.string().trim().max(300).default(''),
  outcomes: z.array(z.string().trim().min(1).max(200)).max(5).default([]),
  /** Shown instead of a 0 price, and next to any price: "giá tham khảo", "từ", "liên hệ". */
  priceNote: z.string().trim().max(120).default(''),
});
export type OfferingDetails = z.infer<typeof OfferingDetails>;
export type OfferingDetailsInput = z.input<typeof OfferingDetails>;

/**
 * The offering kind of a product without one in a business that converts through requests
 * (education: course; spa, saas: service); null for the industries that sell retail stock.
 */
export function defaultOfferingKind(industry: string): OfferingDetails['kind'] | null {
  if (industry === 'education') return 'course';
  if (industry === 'spa' || industry === 'saas') return 'service';
  return null;
}

export const ProductDto = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string().nullable(),
  status: z.enum(['active', 'archived']),
  visibleToBot: z.boolean(),
  botInstructions: z.string().default(''),
  /** Up to 5 https URLs the bot may send to customers who ask to see the product. */
  imageUrls: ProductImageUrls.default([]),
  /** Present only for an entire-property accommodation; retail stock is inapplicable. */
  accommodation: AccommodationDetails.nullable().optional(),
  /** A course or a service (never together with `accommodation`); null for a retail product. */
  offering: OfferingDetails.nullable().default(null),
  variants: z.array(ProductVariantDto),
  priceMin: Money,
  priceMax: Money,
  /** Σ available over variants and warehouses, each row counted at 0 or more (oversold rows add 0). */
  available: z.number().int(),
  /**
   * The PMS record this product is synced from; null for a product managed in Rapiz. A response
   * from an API older than the field (web deployed first) reads as null.
   */
  external: z
    .object({ source: z.literal('kiotviet'), id: z.string() })
    .nullable()
    .default(null),
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

const upsertProductShape = {
  code: Code,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(''),
  category: optionalText(120),
  visibleToBot: z.boolean().default(true),
  botInstructions: z.string().trim().max(4000).default(''),
  imageUrls: ProductImageUrls.default([]),
  accommodation: AccommodationDetails.nullable().optional(),
  /** Omitted on update: the stored offering stays. Null clears it. */
  offering: OfferingDetails.nullable().optional(),
  status: z.enum(['active', 'archived']).default('active'),
  variants: z.array(ProductVariantInput).min(1).max(100),
  /** Create only: also selects the new product for this bot (T-080). Ignored on update. */
  botId: z.uuid().optional(),
};
type UpsertProductShape = {
  variants: { sku: string }[];
  offering?: unknown;
  accommodation?: unknown;
};
/** Marks a variant whose SKU an earlier variant of the product already uses (case-insensitive). */
export const DUPLICATE_SKU_MESSAGE = 'each variant needs a different SKU';
/**
 * Indexes of the variants whose SKU (trimmed, case-insensitive) an earlier variant of the same
 * product already uses; the web form marks exactly these fields (TM-7).
 */
export function duplicateSkuIndexes(variants: readonly { sku: string }[]): number[] {
  const seen = new Set<string>();
  return variants.flatMap((v, i) => {
    const key = v.sku.trim().toLowerCase();
    if (!key) return [];
    if (seen.has(key)) return [i];
    seen.add(key);
    return [];
  });
}
/** The issue sits on the duplicate variant's SKU: `variants.<i>.sku`. */
const distinctSkus = (p: UpsertProductShape, ctx: z.RefinementCtx) => {
  for (const i of duplicateSkuIndexes(p.variants))
    ctx.addIssue({ code: 'custom', message: DUPLICATE_SKU_MESSAGE, path: ['variants', i, 'sku'] });
};
const notBoth = (p: UpsertProductShape) => !p.offering || !p.accommodation;
const NOT_BOTH = {
  message: 'a product is a course or service, or an accommodation, not both',
  path: ['offering'],
};

export const UpsertProductRequest = z
  .object(upsertProductShape)
  .superRefine(distinctSkus)
  .refine(notBoth, NOT_BOTH);
export type UpsertProductRequest = z.input<typeof UpsertProductRequest>;

/**
 * The product body the owner assistant writes (`assistant.body` of the product writes): the same
 * request with a catalog product's accommodation, without the lodging bot product's own fields
 * (T-193), so `tool_describe` stays within its result limit.
 */
export const AssistantUpsertProductRequest = z
  .object({
    ...upsertProductShape,
    accommodation: CatalogAccommodationDetails.nullable().optional(),
  })
  .superRefine(distinctSkus)
  .refine(notBoth, NOT_BOTH);

/**
 * Only the bot's fields of a product (at least one). Stays usable on a PMS-synced product, whose
 * other fields are read-only and may not fit the full product form.
 */
export const UpdateProductBotSettingsRequest = z
  .object({
    visibleToBot: z.boolean().optional(),
    botInstructions: z.string().trim().max(4000).optional(),
  })
  .refine((b) => b.visibleToBot !== undefined || b.botInstructions !== undefined, {
    message: 'send visibleToBot or botInstructions',
  });
export type UpdateProductBotSettingsRequest = z.input<typeof UpdateProductBotSettingsRequest>;

export const ProductListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'archived']).default('active'),
  /** `kiotviet`: products synced from KiotViet; `rapiz`: products managed in Rapiz. */
  source: z.enum(['kiotviet', 'rapiz']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /**
   * `summary`: a compact read for scanning a catalog (the owner assistant reads at most 40 000
   * chars of tool output per turn): rows are `ProductSummaryRow` (name, category, prices, price
   * note, a one-line offering summary; no description), and a page holds at most
   * `PRODUCT_SUMMARY_PAGE_MAX` rows, whatever `pageSize` asks (T-187).
   */
  fields: z.enum(['summary']).optional(),
});

/** Most rows one `GET /products?fields=summary` page returns; a larger `pageSize` is cut. */
export const PRODUCT_SUMMARY_PAGE_MAX = 25;

/** One row of `GET /products?fields=summary`: about 200 chars instead of 1 000+ (QA retest N1). */
export const ProductSummaryRow = z.object({
  id: z.uuid(),
  code: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  priceMin: Money,
  priceMax: Money,
  /** The offering's price note ("liên hệ", "theo phác đồ"); '' when none. */
  priceNote: z.string(),
  /** One line, at most 160 chars: kind, duration, sessions, period, format, level, schedule; '' for retail. */
  offering: z.string(),
});
export type ProductSummaryRow = z.infer<typeof ProductSummaryRow>;

export const ProductSummaryListResponse = z.object({
  data: z.array(ProductSummaryRow),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ProductSummaryListResponse = z.infer<typeof ProductSummaryListResponse>;

/** Page-number pagination: the catalog and order screens show totals and page jumps (ORD-04). */
export const ProductListResponse = z.object({
  data: z.array(ProductDto),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type ProductListResponse = z.infer<typeof ProductListResponse>;

/** The products selected for one bot; used when the bot's catalogMode is 'selected' (T-080). */
export const BotProductsDto = z.object({ productIds: z.array(z.uuid()) });
export type BotProductsDto = z.infer<typeof BotProductsDto>;

export const SetBotProductsRequest = z.object({
  productIds: z
    .array(z.uuid())
    .max(1000)
    .transform((ids) => [...new Set(ids)]),
});
export type SetBotProductsRequest = z.input<typeof SetBotProductsRequest>;

/** Sets the counted quantity of one variant in one warehouse (a stock-take adjustment). */
export const AdjustStockRequest = z.object({
  variantId: z.uuid(),
  warehouseId: z.uuid(),
  onHand: z.number().int().min(0).max(10_000_000),
});
export type AdjustStockRequest = z.infer<typeof AdjustStockRequest>;

/**
 * Which of these product codes and SKUs already exist (case-insensitive), e.g. before an import.
 * Codes are matched against every product (active or archived), SKUs against live variants.
 */
export const MatchProductCodesRequest = z
  .object({
    codes: z.array(Code).max(500).default([]),
    skus: z.array(z.string().trim().min(1).max(64)).max(1_000).default([]),
  })
  .refine((r) => r.codes.length + r.skus.length > 0, {
    message: 'send at least one code or SKU',
    path: ['codes'],
  });
export type MatchProductCodesRequest = z.input<typeof MatchProductCodesRequest>;

/** The codes and SKUs that exist, spelled as the caller sent them. */
export const MatchProductCodesResponse = z.object({
  codes: z.array(z.string()),
  skus: z.array(z.string()),
});
export type MatchProductCodesResponse = z.infer<typeof MatchProductCodesResponse>;

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

/** A blank value means "not given"; whether it may be blank is the source's field policy. */
const blankToUndefined = <T extends z.ZodType>(schema: T) =>
  schema.optional().or(z.literal('').transform(() => undefined));

const Phone = blankToUndefined(
  z
    .string()
    .trim()
    .regex(/^\+?[0-9 .-]{8,15}$/, 'invalid phone number'),
);

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
  address: blankToUndefined(z.string().trim().max(300)),
  province: z.string().trim().max(120).optional(),
  ward: z.string().trim().max(120).optional(),
});
export type OrderRecipient = z.infer<typeof OrderRecipient>;

export const DiscountType = z.enum(['amount', 'percent']);

const OrderLineInput = z.object({
  variantId: z.uuid(),
  qty: z.number().int().min(1).max(10_000),
  /** Overrides the variant price for this order; defaults to it (or to the line's price when editing). */
  unitPrice: Money.optional(),
});

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
    items: z.array(OrderLineInput).min(1).max(200),
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
    /** One per order draft: sending the same id again returns the order created the first time. */
    clientRequestId: z.uuid().optional(),
  })
  .refine((o) => o.discountType !== 'percent' || o.discountValue <= 100, {
    message: 'a percentage discount is at most 100',
    path: ['discountValue'],
  });
export type CreateOrderRequest = z.input<typeof CreateOrderRequest>;

/**
 * Edits of an existing order. Every field is optional; amounts are recomputed.
 * `items` replaces the lines and is accepted only while the order holds its goods
 * (stock state `reserved`); stock reservations move by the difference.
 */
export const UpdateOrderRequest = z.object({
  items: z.array(OrderLineInput).min(1).max(200).optional(),
  discountType: DiscountType.optional(),
  discountValue: Money.optional(),
  shippingFeeCharged: Money.optional(),
  freeShipping: z.boolean().optional(),
  surcharge: Money.optional(),
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
export type UpdateOrderRequest = z.input<typeof UpdateOrderRequest>;

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
  /** "Tổng số tiền": goods + shipping charged + surcharge, before the discount. */
  gross: Money,
  /** "Tiền cần thu": gross − discount. */
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

/**
 * The order's push to a PMS (ADR-017): `pending` while queued or sending, `pushed` with the PMS
 * order code and status, `failed` with an i18n error code. Null: never pushed (default, so an
 * older API still parses).
 */
export const OrderExternalDto = z
  .object({
    state: z.enum(['pending', 'pushed', 'failed']),
    code: z.string().nullable(),
    status: z.string().nullable(),
    error: z
      .object({
        code: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
      })
      .nullable(),
  })
  .nullable()
  .default(null);
export type OrderExternalDto = z.infer<typeof OrderExternalDto>;

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
  ...OrderItemsPreviewFields,
  createdByName: z.string().nullable(),
  ...OrderOriginFields,
  external: OrderExternalDto,
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
  /** `external`: pushed to a PMS, which owns the order's stock from then on. */
  stockState: z.enum(['reserved', 'shipped', 'released', 'returned', 'external']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type OrderDto = z.infer<typeof OrderDto>;

/** `status=a,b`: a comma-separated list (one query parameter keeps URLs and caches simple). */
const StatusList = z
  .string()
  .trim()
  .transform((v) => v.split(',').filter(Boolean))
  .pipe(z.array(OrderStatus).max(OrderStatus.options.length));

/** A comma-separated query parameter read as a list of `item`. */
const csv = <T extends z.ZodType<unknown, string>>(item: T, max: number) =>
  z
    .string()
    .trim()
    .transform((v) =>
      v
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(max));

/** One column's "contains" search (accent- and case-insensitive). */
const ColumnText = z.string().trim().min(1).max(100);
/** An inclusive money bound in VND. */
const MoneyBound = z.coerce.number().int().min(0).max(1_000_000_000_000);

/** Columns the orders list sorts by (Excel-style header menus). */
export const OrderSortColumn = z.enum([
  'placed',
  'code',
  'customer',
  'total',
  'cod',
  'subtotal',
  'shipping',
  'gross',
  'paid',
  'source',
  'creator',
  'status',
  'carrier',
]);
export type OrderSortColumn = z.infer<typeof OrderSortColumn>;
export const OrderSort = z.templateLiteral([OrderSortColumn, '_', z.enum(['asc', 'desc'])]);
export type OrderSort = z.infer<typeof OrderSort>;

/** Bot orders in the creator filter, next to staff user ids. */
export const ORDER_CREATOR_BOT_PENDING = 'bot_pending';
export const ORDER_CREATOR_BOT_APPROVED = 'bot_approved';
const CreatorToken = z.union([
  z.uuid(),
  z.literal(ORDER_CREATOR_BOT_PENDING),
  z.literal(ORDER_CREATOR_BOT_APPROVED),
]);

/** Money columns that take a `<column>Min` / `<column>Max` range. */
export const ORDER_MONEY_COLUMNS = [
  'total',
  'cod',
  'subtotal',
  'shipping',
  'gross',
  'paid',
] as const;

export const OrderListQuery = z.object({
  status: StatusList.optional(),
  /** `exclude`: every order whose status is NOT in `status`. */
  statusMode: z.enum(['include', 'exclude']).default('include'),
  /** @deprecated Use `creator`. One staff user id. */
  createdBy: z.uuid().optional(),
  /** @deprecated Use `creator=bot_pending`. Only bot orders that staff have not approved yet. */
  review: z.enum(['pending']).optional(),
  /** Any of: staff user ids, `bot_pending`, `bot_approved` (comma-separated). */
  creator: csv(CreatorToken, 100).optional(),
  /** Exact carrier names as entered on the order (comma-separated). */
  carrier: csv(z.string().min(1).max(60), 100).optional(),
  /** Order code, tracking code, customer/recipient name, phone, address, notes (accent-insensitive). */
  q: z.string().trim().max(100).optional(),
  /** Any of these sources (comma-separated). */
  source: csv(OrderSource, OrderSource.options.length).optional(),
  /** Per-column "contains" searches; all given ones must match. */
  code: ColumnText.optional(),
  tracking: ColumnText.optional(),
  /** Customer or recipient name. */
  customer: ColumnText.optional(),
  /** Customer or recipient phone; digits match whatever the formatting (`+84`/`0`). */
  phone: ColumnText.optional(),
  /** Recipient address. */
  address: ColumnText.optional(),
  /** Any line's product or variant name. */
  product: ColumnText.optional(),
  /** Internal or printed note. */
  note: ColumnText.optional(),
  totalMin: MoneyBound.optional(),
  totalMax: MoneyBound.optional(),
  codMin: MoneyBound.optional(),
  codMax: MoneyBound.optional(),
  subtotalMin: MoneyBound.optional(),
  subtotalMax: MoneyBound.optional(),
  shippingMin: MoneyBound.optional(),
  shippingMax: MoneyBound.optional(),
  grossMin: MoneyBound.optional(),
  grossMax: MoneyBound.optional(),
  paidMin: MoneyBound.optional(),
  paidMax: MoneyBound.optional(),
  /** Inclusive local dates (workspace time zone), yyyy-mm-dd. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  sort: OrderSort.default('placed_desc'),
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
  /** Footer totals over every matching order, not only this page; cancelled orders add nothing. */
  totals: z.object({
    itemQty: z.number().int(),
    shippingFeeCharged: Money,
    cod: Money,
    gross: Money,
    total: Money,
  }),
  /** Values the creator and carrier filters can take (over every order of the workspace). */
  facets: z.object({
    creators: z.array(z.object({ id: z.uuid(), name: z.string() })),
    carriers: z.array(z.string()),
    /**
     * Per value, the orders matching every filter except that column's own (Excel-style counts
     * in the header menus). `creator` keys: staff user ids, `bot_pending`, `bot_approved`.
     */
    counts: z
      .object({
        source: z.record(z.string(), z.number().int()),
        creator: z.record(z.string(), z.number().int()),
        carrier: z.record(z.string(), z.number().int()),
      })
      .optional(),
  }),
});
export type OrderListResponse = z.infer<typeof OrderListResponse>;
