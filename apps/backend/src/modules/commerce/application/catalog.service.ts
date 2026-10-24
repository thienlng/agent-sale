import type {
  AdjustStockRequest,
  ProductDto,
  ProductListResponse,
  UpsertProductRequest,
  UpsertWarehouseRequest,
  VariantOption,
  WarehouseDto,
} from '@agent-sales/contracts';
import {
  UpsertProductRequest as UpsertProductSchema,
  UpsertWarehouseRequest as UpsertWarehouseSchema,
} from '@agent-sales/contracts';
import { foldVietnamese, isUuid, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import {
  ProductNotFoundError,
  WarehouseInUseError,
  WarehouseNotFoundError,
} from '../domain/commerce.errors.js';
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
    variants: dtoVariants,
    priceMin: prices.length ? Math.min(...prices) : 0,
    priceMax: prices.length ? Math.max(...prices) : 0,
    available: dtoVariants.reduce((n, v) => n + v.stock.reduce((m, s) => m + s.available, 0), 0),
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

/** Text the catalog search (and the order form picker) matches against. */
function productSearchText(
  p: { code: string; name: string },
  variants: Array<{ sku: string; name: string }>,
): string {
  return foldVietnamese([p.code, p.name, ...variants.flatMap((v) => [v.sku, v.name])].join(' '));
}

/** Warehouses, products with variants, stock adjustments and the order-form picker (ORD-01, ORD-02). */
@Injectable()
export class CatalogService {
  constructor(@Inject(COMMERCE_STORE) private readonly store: CommerceStore) {}

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

  listProducts(
    ws: WorkspaceId,
    query: {
      q?: string | undefined;
      status: 'active' | 'archived';
      page: number;
      pageSize: number;
    },
  ): Promise<ProductListResponse> {
    return this.store.run(ws, async (tx) => {
      const { rows, total } = await tx.products.list({
        q: query.q ? foldVietnamese(query.q) : undefined,
        status: query.status,
        offset: (query.page - 1) * query.pageSize,
        limit: query.pageSize,
      });
      const variants = await tx.products.variantsOf(rows.map((r) => r.id));
      const stock = await tx.inventory.stockOf(variants.map((v) => v.id));
      return {
        data: rows.map((p) =>
          toProductDto(
            p,
            variants.filter((v) => v.productId === p.id),
            stock,
          ),
        ),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }

  getProduct(ws: WorkspaceId, id: string): Promise<ProductDto> {
    return this.store.run(ws, (tx) => this.#productDto(tx, id));
  }

  createProduct(ws: WorkspaceId, raw: UpsertProductRequest): Promise<ProductDto> {
    const input = UpsertProductSchema.parse(raw);
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
      return this.#productDto(tx, product.id);
    });
  }

  /**
   * Replaces the product and its variant list: listed variants are updated or
   * added, the others are archived (never deleted — past orders reference them).
   */
  updateProduct(ws: WorkspaceId, id: string, raw: UpsertProductRequest): Promise<ProductDto> {
    const input = UpsertProductSchema.parse(raw);
    return this.store.run(ws, async (tx) => {
      const current = await this.#product(tx, id);
      const existing = (await tx.products.variantsOf([id])).filter((v) => !v.archived);
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
        searchText: productSearchText(input, input.variants),
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
      await this.#product(tx, productId);
      const variant = (await tx.products.variantsOf([productId])).find(
        (v) => v.id === input.variantId && !v.archived,
      );
      if (!variant) throw new ProductNotFoundError(input.variantId);
      await this.#warehouse(tx, input.warehouseId);
      const current = (await tx.inventory.stockOf([variant.id])).find(
        (s) => s.warehouseId === input.warehouseId,
      );
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

  async #product(tx: CommerceTx, id: string): Promise<ProductRecord> {
    const p = isUuid(id) ? await tx.products.find(id) : null;
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
