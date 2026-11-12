import type {
  AccommodationDetails,
  MatchProductCodesResponse,
  AdjustStockRequest,
  BotProductsDto,
  ProductDto,
  ProductListResponse,
  ProductSummaryListResponse,
  ProductSummaryRow,
  UpdateProductBotSettingsRequest,
  UpsertProductRequest,
  UpsertWarehouseRequest,
  VariantOption,
  WarehouseDto,
} from '@agent-sales/contracts';
import {
  PRODUCT_SUMMARY_PAGE_MAX,
  SetBotProductsRequest,
  UpdateProductBotSettingsRequest as UpdateProductBotSettingsSchema,
  UpsertProductRequest as UpsertProductSchema,
  UpsertWarehouseRequest as UpsertWarehouseSchema,
} from '@agent-sales/contracts';
import { foldVietnamese, isUuid, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import { toMediaPath } from '../../../common/storage/media-url.js';
import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { PRODUCT_IMAGE_STORAGE } from './ports/product-image-storage.js';

import type { BotCatalogScope } from '../api/catalog.facade.js';
import { catalogTerms, coversAge, queryAge } from '../domain/bot-catalog-query.js';
import { LodgingError } from '../domain/lodging.js';
import {
  BotNotFoundError,
  ProductNotDeletableError,
  ProductNotFoundError,
  WarehouseInUseError,
  WarehouseNotFoundError,
  CommerceUnavailableError,
  ExternalSourceLockedError,
  ImageNotUploadedError,
  AlbumsLodgingOnlyError,
} from '../domain/commerce.errors.js';
import { lockedChange } from '../domain/external-lock.js';
import { ownImageProblem } from '../domain/own-image.js';
import {
  COMMERCE_STORE,
  type CommerceStore,
  type CommerceTx,
  type ProductRecord,
  type StockRecord,
  type VariantRecord,
  type WarehouseRecord,
} from './ports/commerce-store.js';

export function toWarehouseDto(w: WarehouseRecord): WarehouseDto {
  return { ...w };
}

/**
 * Rapiz pictures as host-relative `/media/…` paths (stored that way from now on; older rows hold
 * the absolute URL of a former public host). External links stay as they are.
 */
function withMediaPaths<
  T extends { imageUrls: string[]; accommodation?: AccommodationDetails | null | undefined },
>(p: T): T {
  return {
    ...p,
    imageUrls: p.imageUrls.map(toMediaPath),
    ...(p.accommodation
      ? {
          accommodation: {
            ...p.accommodation,
            gallery: p.accommodation.gallery.map((g) => ({ ...g, url: toMediaPath(g.url) })),
          },
        }
      : {}),
  };
}

function toProductDto(
  p: ProductRecord,
  variants: VariantRecord[],
  stock: StockRecord[],
): ProductDto {
  const live = variants.filter((v) => !v.archived).sort((a, b) => a.position - b.position);
  const dtoVariants = live.map((v) => ({
    id: v.id,
    sku: v.sku,
    name: v.name,
    price: v.price,
    cost: v.cost,
    weightGram: v.weightGram,
    stock: stock
      .filter((s) => s.variantId === v.id)
      .map((s) => ({
        warehouseId: s.warehouseId,
        onHand: s.onHand,
        reserved: s.reserved,
        available: s.onHand - s.reserved,
      })),
  }));
  const prices = live.map((v) => v.price);
  return {
    id: p.id,
    code: p.code,
    name: p.name,
    description: p.description,
    category: p.category,
    status: p.status,
    visibleToBot: p.visibleToBot,
    botInstructions: p.botInstructions,
    ...withMediaPaths({
      imageUrls: p.imageUrls,
      ...(p.accommodation ? { accommodation: p.accommodation } : {}),
    }),
    offering: p.offering ?? null,
    variants: dtoVariants,
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
    available: dtoVariants.reduce((n, v) => n + v.stock.reduce((m, s) => m + s.available, 0), 0),
    external: p.external ?? null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

const SUMMARY_OFFERING_CHARS = 160;

/** One line for an offering: kind, duration, sessions, period, format, level, schedule. */
function offeringLine(o: NonNullable<ProductDto['offering']>): string {
  const parts = [
    o.kind,
    o.durationMinutes ? `${o.durationMinutes} min` : '',
    o.sessions ? `${o.sessions} sessions` : '',
    o.period,
    o.format ?? '',
    o.level ? `level ${o.level}` : '',
    o.schedule ? `schedule ${o.schedule}` : '',
  ].filter(Boolean);
  const line = parts.join(', ').replace(/\s+/g, ' ');
  return line.length > SUMMARY_OFFERING_CHARS
    ? `${line.slice(0, SUMMARY_OFFERING_CHARS - 1).trimEnd()}…`
    : line;
}

/**
 * The compact row of `GET /products?fields=summary` (T-187, QA retest N1): no description,
 * variants, pictures or stock, so a 20-product page stays far under the turn's read budget.
 */
export function productSummary(d: ProductDto): ProductSummaryRow {
  return {
    id: d.id,
    code: d.code,
    name: d.name,
    category: d.category,
    priceMin: d.priceMin,
    priceMax: d.priceMax,
    priceNote: d.offering?.priceNote ?? '',
    offering: d.offering ? offeringLine(d.offering) : '',
  };
}

/** Text the catalog search (and the order form picker) matches against. */
function productSearchText(
  p: { code: string; name: string },
  variants: Array<{ sku: string; name: string }>,
): string {
  return foldVietnamese([p.code, p.name, ...variants.flatMap((v) => [v.sku, v.name])].join(' '));
}

/**
 * Search rows with the products whose stated ages cover `age` first, then those that state no
 * age, then those for other ages; each group keeps the search order. Null `age` keeps the rows.
 */
function byAge(rows: ProductDto[], age: number | null): ProductDto[] {
  if (age === null) return rows;
  const group = (d: ProductDto) => {
    const covers = coversAge(
      [d.name, d.description, d.offering?.audience ?? '', d.offering?.level ?? ''].join(' \n '),
      age,
    );
    return covers === true ? 0 : covers === null ? 1 : 2;
  };
  return rows
    .map((d, i) => ({ d, i, g: group(d) }))
    .sort((a, b) => a.g - b.g || a.i - b.i)
    .map((x) => x.d);
}

/** Most rows a bot catalog search or browse returns (spec §5). */
const BOT_CATALOG_CAP = 300;

/** The bot_products filter for a bot in 'selected' mode; undefined sells every active product. */
function selection(bot: BotCatalogScope): string | undefined {
  return bot.catalogMode === 'selected' ? bot.botId : undefined;
}

/** Warehouses, products with variants, stock adjustments and the order-form picker (ORD-01, ORD-02). */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(PRODUCT_IMAGE_STORAGE) private readonly images: PublicObjectStorage,
  ) {}

  /**
   * Pictures are files Rapiz stored for this workspace; links are refused, kept ones included.
   * Media folders are refused outright: only the lodging bot product carries them.
   */
  #assertOwnImages(ws: WorkspaceId, input: ReturnType<typeof UpsertProductSchema.parse>): void {
    input.imageUrls.forEach((url, i) => {
      if (ownImageProblem(url, ws, this.images)) throw new ImageNotUploadedError(`imageUrls[${i}]`);
    });
    if (input.accommodation?.albums !== undefined) throw new AlbumsLodgingOnlyError();
    input.accommodation?.gallery.forEach((g, i) => {
      if (ownImageProblem(g.url, ws, this.images))
        throw new ImageNotUploadedError(`gallery[${i}].url`);
    });
  }

  async searchBotCatalog(
    ws: WorkspaceId,
    bot: BotCatalogScope,
    input: { query?: string; maxPriceVnd?: number; inStockOnly?: boolean; limit: number },
  ): Promise<ProductDto[]> {
    const limit = Math.max(1, Math.min(input.limit, BOT_CATALOG_CAP));
    const terms = catalogTerms(input.query ?? '');
    // A query with no usable term ("a", "?!") matches nothing; only a missing query browses.
    if (!terms.length && (input.query ?? '').trim()) return [];
    const query = terms.length
      ? foldVietnamese(input.query ?? '')
          .replace(/[^\p{L}\p{N}]+/gu, ' ')
          .trim()
      : '';
    // A course for "con 7 tuổi": the products whose stated ages cover it come first (T-187).
    const age = terms.length ? queryAge(input.query ?? '') : null;
    // Price and stock are computed from variants and stock rows, so they filter after the query.
    const filtered = input.maxPriceVnd !== undefined || input.inStockOnly === true || age !== null;
    try {
      return await this.store.run(ws, async (tx) => {
        const rows = await tx.products.searchForBot({
          terms,
          query,
          selectedFor: selection(bot),
          withStatedAges: age !== null,
          limit: filtered ? BOT_CATALOG_CAP : limit,
        });
        const dtos = byAge(await this.#dtos(tx, rows), age);
        // An accommodation has no stock and a rate reference rather than a price: neither filter applies.
        return (
          dtos
            .filter(
              (d) =>
                d.accommodation !== undefined ||
                input.maxPriceVnd === undefined ||
                d.priceMin <= input.maxPriceVnd,
            )
            // A course or a service has no stock either (T-187).
            .filter(
              (d) =>
                d.accommodation !== undefined ||
                d.offering !== null ||
                !input.inStockOnly ||
                d.available > 0,
            )
            .slice(0, limit)
        );
      });
    } catch (error) {
      if (error instanceof CommerceUnavailableError) return [];
      throw error;
    }
  }

  async getBotProductsByIds(
    ws: WorkspaceId,
    bot: BotCatalogScope,
    ids: readonly string[],
  ): Promise<ProductDto[]> {
    const wanted = [...new Set(ids)].filter(isUuid).slice(0, 10);
    if (!wanted.length) return [];
    try {
      return await this.store.run(ws, async (tx) => {
        const rows = await tx.products.findForBot(wanted, selection(bot));
        const dtos = new Map((await this.#dtos(tx, rows)).map((d) => [d.id, d]));
        return wanted.flatMap((id) => dtos.get(id) ?? []);
      });
    } catch (error) {
      if (error instanceof CommerceUnavailableError) return [];
      throw error;
    }
  }

  async countBotCatalog(ws: WorkspaceId, bot: BotCatalogScope): Promise<number> {
    try {
      return await this.store.run(ws, (tx) => tx.products.countForBot(selection(bot)));
    } catch (error) {
      if (error instanceof CommerceUnavailableError) return 0;
      throw error;
    }
  }

  async #dtos(tx: CommerceTx, rows: ProductRecord[]): Promise<ProductDto[]> {
    const variants = await tx.products.variantsOf(rows.map((r) => r.id));
    const stock = await tx.inventory.stockOf(variants.map((v) => v.id));
    return rows.map((p) =>
      toProductDto(
        p,
        variants.filter((v) => v.productId === p.id),
        stock,
      ),
    );
  }

  // ─── Warehouses ───────────────────────────────────────────────────────────

  async listWarehouses(ws: WorkspaceId): Promise<WarehouseDto[]> {
    return (await this.store.run(ws, (tx) => tx.warehouses.list())).map(toWarehouseDto);
  }

  createWarehouse(ws: WorkspaceId, raw: UpsertWarehouseRequest): Promise<WarehouseDto> {
    const input = UpsertWarehouseSchema.parse(raw);
    return this.store.run(ws, async (tx) => {
      // The first warehouse is the default one; asking for default moves it here.
      const makeDefault = input.isDefault === true || !(await tx.warehouses.findDefault());
      if (makeDefault) await tx.warehouses.clearDefault();
      const w: WarehouseRecord = {
        id: newId(),
        name: input.name,
        phone: input.phone ?? null,
        province: input.province ?? null,
        ward: input.ward ?? null,
        addressDetail: input.addressDetail ?? null,
        isDefault: makeDefault,
      };
      await tx.warehouses.insert(w);
      return toWarehouseDto(w);
    });
  }

  updateWarehouse(ws: WorkspaceId, id: string, raw: UpsertWarehouseRequest): Promise<WarehouseDto> {
    const input = UpsertWarehouseSchema.parse(raw);
    return this.store.run(ws, async (tx) => {
      const current = await this.#warehouse(tx, id);
      // Default can be moved to another warehouse, never removed (there is always one).
      const makeDefault = current.isDefault || input.isDefault === true;
      if (makeDefault && !current.isDefault) await tx.warehouses.clearDefault();
      const w: WarehouseRecord = {
        ...current,
        name: input.name,
        phone: input.phone ?? null,
        province: input.province ?? null,
        ward: input.ward ?? null,
        addressDetail: input.addressDetail ?? null,
        isDefault: makeDefault,
      };
      await tx.warehouses.update(w);
      return toWarehouseDto(w);
    });
  }

  deleteWarehouse(ws: WorkspaceId, id: string): Promise<void> {
    return this.store.run(ws, async (tx) => {
      const w = await this.#warehouse(tx, id);
      if (w.isDefault) throw new WarehouseInUseError('default');
      if (await tx.warehouses.hasStock(id)) throw new WarehouseInUseError('stock');
      if (await tx.warehouses.hasOrders(id)) throw new WarehouseInUseError('orders');
      await tx.warehouses.softDelete(id);
    });
  }

  // ─── Products ─────────────────────────────────────────────────────────────

  /** Which of these codes and SKUs exist in the workspace, spelled as sent (case-insensitive). */
  matchCodes(
    ws: WorkspaceId,
    req: { codes: string[]; skus: string[] },
  ): Promise<MatchProductCodesResponse> {
    return this.store.run(ws, (tx) => tx.products.matchCodes(req.codes, req.skus));
  }

  listProducts(
    ws: WorkspaceId,
    query: {
      q?: string | undefined;
      status: 'active' | 'archived';
      page: number;
      pageSize: number;
      /** Only the products selected for this bot (internal: bots in 'selected' mode). */
      selectedFor?: string | undefined;
      /** `kiotviet`: synced from KiotViet; `rapiz`: managed in Rapiz. */
      source?: 'kiotviet' | 'rapiz' | undefined;
      /** `summary`: the compact projection of `ProductListQuery.fields`. */
      fields?: 'summary' | undefined;
    },
  ): Promise<ProductListResponse | ProductSummaryListResponse> {
    const summary = query.fields === 'summary';
    const pageSize = summary ? Math.min(query.pageSize, PRODUCT_SUMMARY_PAGE_MAX) : query.pageSize;
    return this.store.run(ws, async (tx) => {
      const { rows, total } = await tx.products.list({
        q: query.q ? foldVietnamese(query.q) : undefined,
        status: query.status,
        selectedFor: query.selectedFor,
        source: query.source,
        offset: (query.page - 1) * pageSize,
        limit: pageSize,
      });
      const variants = await tx.products.variantsOf(rows.map((r) => r.id));
      const stock = await tx.inventory.stockOf(variants.map((v) => v.id));
      const dtos = rows.map((p) =>
        toProductDto(
          p,
          variants.filter((v) => v.productId === p.id),
          stock,
        ),
      );
      if (summary) return { data: dtos.map(productSummary), total, page: query.page, pageSize };
      return { data: dtos, total, page: query.page, pageSize };
    });
  }

  getProduct(ws: WorkspaceId, id: string): Promise<ProductDto> {
    return this.store.run(ws, (tx) => this.#productDto(tx, id));
  }

  createProduct(ws: WorkspaceId, raw: UpsertProductRequest): Promise<ProductDto> {
    const input = withMediaPaths(UpsertProductSchema.parse(raw));
    this.#assertOwnImages(ws, input);
    if (input.accommodation && input.variants.length !== 1)
      throw new LodgingError(
        'VALIDATION_FAILED',
        'An entire property has one catalog unit, not separate room or weekday variants',
      );
    return this.store.run(ws, async (tx) => {
      const now = new Date();
      const product: ProductRecord = {
        id: newId(),
        code: input.code,
        name: input.name,
        description: input.description,
        category: input.category ?? null,
        status: input.status,
        visibleToBot: input.visibleToBot,
        botInstructions: input.botInstructions,
        imageUrls: input.imageUrls,
        accommodation: input.accommodation ?? null,
        offering: input.offering ?? null,
        external: null,
        searchText: productSearchText(input, input.variants),
        createdAt: now,
        updatedAt: now,
      };
      await tx.products.save(product);
      await tx.products.saveVariants(
        ws,
        input.variants.map((v, position) => ({
          id: newId(),
          productId: product.id,
          sku: v.sku,
          name: v.name,
          price: v.price,
          cost: v.cost,
          weightGram: v.weightGram,
          position,
          archived: false,
        })),
      );
      if (input.botId) await tx.botProducts.add(ws, input.botId, product.id);
      return this.#productDto(tx, product.id);
    });
  }

  // ─── Per-bot selection (T-080, ADR-012 §5) ────────────────────────────────

  async listBotProducts(ws: WorkspaceId, botId: string): Promise<BotProductsDto> {
    if (!isUuid(botId)) throw new BotNotFoundError(botId);
    return { productIds: await this.store.run(ws, (tx) => tx.botProducts.list(botId)) };
  }

  /** Replaces the selection; a bot or product outside the workspace is NOT_FOUND. */
  async setBotProducts(
    ws: WorkspaceId,
    botId: string,
    raw: SetBotProductsRequest,
  ): Promise<BotProductsDto> {
    if (!isUuid(botId)) throw new BotNotFoundError(botId);
    const { productIds } = SetBotProductsRequest.parse(raw);
    return this.store.run(ws, async (tx) => {
      await tx.botProducts.replace(ws, botId, productIds);
      return { productIds: await tx.botProducts.list(botId) };
    });
  }

  /**
   * Replaces the product and its variant list: listed variants are updated or
   * added, the others are archived (never deleted — past orders reference them).
   */
  updateProduct(ws: WorkspaceId, id: string, raw: UpsertProductRequest): Promise<ProductDto> {
    const input = withMediaPaths(UpsertProductSchema.parse(raw));
    this.#assertOwnImages(ws, input);
    return this.store.run(ws, async (tx) => {
      // Locked so a PMS sync and a staff save cannot overwrite each other's fields.
      const current = await this.#product(tx, id, { forUpdate: true });
      if (current.accommodation && input.accommodation === null)
        throw new LodgingError('CONFLICT', 'An accommodation cannot be converted into stock goods');
      if (!current.accommodation && input.accommodation)
        throw new LodgingError(
          'CONFLICT',
          'Create a separate accommodation instead of converting existing stock goods',
        );
      if (current.accommodation && input.variants.length !== 1)
        throw new LodgingError('VALIDATION_FAILED', 'An entire property has one catalog unit');
      // Omitted keeps the stored course or service details; null turns the product into retail.
      const offering = input.offering === undefined ? (current.offering ?? null) : input.offering;
      const accommodation =
        input.accommodation === undefined ? (current.accommodation ?? null) : input.accommodation;
      if (offering && accommodation)
        throw new LodgingError(
          'VALIDATION_FAILED',
          'A product is a course or service, or an accommodation, never both',
        );
      const existing = (await tx.products.variantsOf([id])).filter((v) => !v.archived);
      // A PMS-synced product: only the Rapiz-owned fields may change (ADR-017).
      if (current.external) {
        const field = lockedChange({ ...current, variants: existing }, input);
        if (field) throw new ExternalSourceLockedError(field);
      }
      const known = new Map(existing.map((v) => [v.id, v]));
      const kept = new Set<string>();
      const variants: VariantRecord[] = input.variants.map((v, position) => {
        const prior = v.id ? known.get(v.id) : undefined;
        if (prior) kept.add(prior.id);
        return {
          id: prior?.id ?? newId(),
          productId: id,
          sku: v.sku,
          name: v.name,
          price: v.price,
          cost: v.cost,
          weightGram: v.weightGram,
          position,
          archived: false,
          // A kept variant keeps its PMS link; a new one has none.
          externalId: prior?.externalId ?? null,
        };
      });
      // Archive first so a SKU can move from a removed variant to a new one.
      await tx.products.archiveVariants(existing.filter((v) => !kept.has(v.id)).map((v) => v.id));
      await tx.products.saveVariants(ws, variants);
      await tx.products.save({
        ...current,
        code: input.code,
        name: input.name,
        description: input.description,
        category: input.category ?? null,
        status: input.status,
        visibleToBot: input.visibleToBot,
        botInstructions: input.botInstructions,
        imageUrls: input.imageUrls,
        accommodation,
        offering,
        searchText: productSearchText(input, input.variants),
        updatedAt: new Date(),
      });
      return this.#productDto(tx, id);
    });
  }

  /**
   * Hard delete of a product nobody ordered (a product created by mistake). Order lines keep a
   * variant reference, so a product in any order (`product_in_orders`) is archived instead; a
   * PMS-synced one (`product_synced`) would come back on the next sync. Pictures stay in storage:
   * the same object can be referenced elsewhere (a lodging gallery, a copied product).
   */
  deleteProduct(ws: WorkspaceId, id: string, actorUserId: string): Promise<void> {
    return this.store.run(ws, async (tx) => {
      const product = await this.#product(tx, id, { forUpdate: true });
      if (product.external) throw new ProductNotDeletableError('product_synced');
      if (await tx.products.usedByOrders(product.id))
        throw new ProductNotDeletableError('product_in_orders');
      await tx.products.remove(product.id);
      await tx.audit.write({
        actorUserId,
        action: 'commerce.product.deleted',
        targetType: 'product',
        targetId: product.id,
        data: { code: product.code },
      });
    });
  }

  /**
   * Only the bot's fields; works for every product, including a PMS-synced one whose data the
   * full product form would refuse (ADR-017).
   */
  updateBotSettings(
    ws: WorkspaceId,
    id: string,
    raw: UpdateProductBotSettingsRequest,
  ): Promise<ProductDto> {
    const input = UpdateProductBotSettingsSchema.parse(raw);
    return this.store.run(ws, async (tx) => {
      const current = await this.#product(tx, id, { forUpdate: true });
      await tx.products.save({
        ...current,
        visibleToBot: input.visibleToBot ?? current.visibleToBot,
        botInstructions: input.botInstructions ?? current.botInstructions,
        updatedAt: new Date(),
      });
      return this.#productDto(tx, id);
    });
  }

  /** Stock-take: sets on-hand to the counted quantity and logs the difference. */
  adjustStock(
    ws: WorkspaceId,
    productId: string,
    input: AdjustStockRequest,
    actorUserId: string,
  ): Promise<ProductDto> {
    return this.store.run(ws, async (tx) => {
      const product = await this.#product(tx, productId);
      if (product.accommodation)
        throw new LodgingError(
          'VALIDATION_FAILED',
          'Accommodations use stay dates, not warehouse inventory',
        );
      const variant = (await tx.products.variantsOf([productId])).find(
        (v) => v.id === input.variantId && !v.archived,
      );
      if (!variant) throw new ProductNotFoundError(input.variantId);
      if (product.offering)
        throw new LodgingError('VALIDATION_FAILED', 'A course or a service has no stock');
      // The PMS owns the stock of a synced product.
      if (product.external) throw new ExternalSourceLockedError('stock');
      await this.#warehouse(tx, input.warehouseId);
      // Locked so an order shipping at the same moment cannot skew the counted value.
      const current = await tx.inventory.lockStock(variant.id, input.warehouseId);
      const delta = input.onHand - (current?.onHand ?? 0);
      if (delta !== 0) {
        await tx.inventory.apply(ws, [
          {
            variantId: variant.id,
            warehouseId: input.warehouseId,
            onHandDelta: delta,
            reservedDelta: 0,
            reason: 'adjust',
            refType: 'stocktake',
            refId: null,
            actorUserId,
          },
        ]);
      }
      return this.#productDto(tx, productId);
    });
  }

  searchVariants(
    ws: WorkspaceId,
    query: { q?: string | undefined; warehouseId: string; inStock: boolean },
  ): Promise<VariantOption[]> {
    return this.store.run(ws, async (tx) => {
      await this.#warehouse(tx, query.warehouseId);
      const rows = await tx.products.searchVariants({
        q: query.q ? foldVietnamese(query.q) : undefined,
        warehouseId: query.warehouseId,
        inStock: query.inStock,
        limit: 30,
      });
      return rows.map((r) => ({
        variantId: r.id,
        productId: r.productId,
        productCode: r.productCode,
        productName: r.productName,
        variantName: r.name,
        sku: r.sku,
        price: r.price,
        available: r.onHand - r.reserved,
      }));
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  async #warehouse(tx: CommerceTx, id: string): Promise<WarehouseRecord> {
    const w = isUuid(id) ? await tx.warehouses.find(id) : null;
    if (!w) throw new WarehouseNotFoundError(id);
    return w;
  }

  async #product(
    tx: CommerceTx,
    id: string,
    opts?: { forUpdate?: boolean },
  ): Promise<ProductRecord> {
    const p = isUuid(id) ? await tx.products.find(id, opts) : null;
    if (!p) throw new ProductNotFoundError(id);
    return p;
  }

  async #productDto(tx: CommerceTx, id: string): Promise<ProductDto> {
    const p = await this.#product(tx, id);
    const variants = await tx.products.variantsOf([id]);
    const stock = await tx.inventory.stockOf(variants.map((v) => v.id));
    return toProductDto(p, variants, stock);
  }
}
