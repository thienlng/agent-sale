import { foldVietnamese, newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import type {
  CatalogSyncFacade,
  ExternalCatalogItem,
  ExternalSource,
  ExternalVariantInput,
  UpsertExternalProductResult,
} from '../api/catalog-sync.facade.js';
import { NoWarehouseError } from '../domain/commerce.errors.js';
import {
  COMMERCE_STORE,
  type CommerceStore,
  type CommerceTx,
  type ProductRecord,
  type VariantRecord,
} from './ports/commerce-store.js';
import {
  EXTERNAL_IMAGE_DOWNLOADER,
  type ExternalImageDownloader,
} from './ports/external-image-downloader.js';
import { PRODUCT_IMAGE_STORAGE } from './ports/product-image-storage.js';

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png' } as const;

const fold = (sku: string) => sku.trim().toLowerCase();

/** Same text the catalog search matches (CatalogService.productSearchText). */
function searchText(code: string, name: string, variants: Array<{ sku: string; name: string }>) {
  return foldVietnamese([code, name, ...variants.flatMap((v) => [v.sku, v.name])].join(' '));
}

/**
 * The PMS sync's writes (ADR-017, spec §4.4): products and variants by external id, stock at the
 * default warehouse through the inventory movement log, pictures into Rapiz storage.
 */
@Injectable()
export class CatalogSyncService implements CatalogSyncFacade {
  constructor(
    @Inject(COMMERCE_STORE) private readonly store: CommerceStore,
    @Inject(PRODUCT_IMAGE_STORAGE) private readonly images: PublicObjectStorage,
    @Inject(EXTERNAL_IMAGE_DOWNLOADER) private readonly download: ExternalImageDownloader,
  ) {}

  previewExternalMatch(
    ws: WorkspaceId,
    codes: string[],
  ): Promise<{ matched: number; created: number; rapizOnly: number }> {
    const unique = [...new Set(codes.map(fold).filter(Boolean))];
    return this.store.run(ws, async (tx) => {
      const { matched, rapizOnly } = await tx.catalogSync.previewMatch(unique);
      return { matched, created: unique.length - matched, rapizOnly };
    });
  }

  upsertExternalProduct(
    ws: WorkspaceId,
    source: ExternalSource,
    item: ExternalCatalogItem,
  ): Promise<UpsertExternalProductResult> {
    const inputs = [...item.variants]
      .map((v) => ({ ...v, sku: v.sku.trim(), name: v.name.trim() }))
      .sort((a, b) => a.position - b.position);
    return this.store.run(ws, async (tx) => {
      const found =
        (await tx.catalogSync.findProduct(source, item.externalId)) ??
        (await this.#adoptable(tx, inputs));
      const productId = found?.id ?? newId();

      // A variant id the PMS moved here from another product: that variant goes (archived).
      const byExternal = await tx.catalogSync.variantsByExternalIds(
        inputs.map((v) => v.externalId),
      );
      await tx.catalogSync.archiveAndUnlinkVariants(
        byExternal.filter((v) => v.productId !== productId).map((v) => v.id),
      );

      // Live variants of other products keep their SKUs: those inputs are skipped.
      const taken = new Set(
        (await tx.botOrders.variantsBySkus(inputs.map((v) => v.sku)))
          .filter((v) => !v.archived && v.productId !== productId)
          .map((v) => fold(v.sku)),
      );
      const skipped = inputs.filter((v) => taken.has(fold(v.sku))).map((v) => v.sku);
      const kept = inputs.filter((v) => !taken.has(fold(v.sku)));

      const all = found ? await tx.products.variantsOf([productId]) : [];
      const existing = all.filter((v) => !v.archived);
      const variants = this.#matchVariants(productId, kept, all);
      const keptIds = new Set(variants.map((v) => v.id));
      // Archive first so a SKU can move from a removed variant to another one.
      await tx.products.archiveVariants(
        existing.filter((v) => !keptIds.has(v.id)).map((v) => v.id),
      );

      const name = item.name.trim();
      const code = found?.code ?? (await this.#newCode(tx, inputs[0]?.sku ?? '', item.externalId));
      const now = new Date();
      // Linked fields only; visibleToBot, botInstructions and accommodation stay as they are.
      const product: ProductRecord = {
        ...(found ?? {
          id: productId,
          visibleToBot: true,
          botInstructions: '',
          accommodation: null,
          createdAt: now,
        }),
        code,
        name,
        description: item.description.trim(),
        category: item.category?.trim() || null,
        status: item.active ? 'active' : 'archived',
        imageUrls: item.imageUrls,
        external: { source, id: item.externalId },
        searchText: searchText(code, name, variants),
        updatedAt: now,
      };
      await tx.products.save(product);
      await tx.products.saveVariants(ws, variants);

      const warehouse = await tx.warehouses.findDefault();
      if (warehouse) {
        const known = new Set(existing.map((v) => v.id));
        for (const v of variants.filter((x) => !known.has(x.id)))
          await tx.inventory.ensureRow(ws, v.id, warehouse.id);
      }
      return { productId, created: !found, skipped };
    });
  }

  removeExternalProducts(
    ws: WorkspaceId,
    source: ExternalSource,
    externalIds: string[],
  ): Promise<number> {
    if (!externalIds.length) return Promise.resolve(0);
    return this.store.run(ws, (tx) => tx.catalogSync.archiveProducts(source, externalIds));
  }

  setExternalStock(
    ws: WorkspaceId,
    source: ExternalSource,
    rows: Array<{ externalVariantId: string; available: number }>,
  ): Promise<number> {
    if (!rows.length) return Promise.resolve(0);
    return this.store.run(ws, async (tx) => {
      const warehouse = await tx.warehouses.findDefault();
      if (!warehouse) throw new NoWarehouseError();
      const wanted = new Map(rows.map((r) => [r.externalVariantId, r.available]));
      const variants = (await tx.catalogSync.variantsByExternalIds([...wanted.keys()]))
        .filter((v) => !v.archived && v.productSource === source)
        // Rows locked in one fixed order, like inventory.apply, so syncs and orders cannot deadlock.
        .sort((a, b) => a.id.localeCompare(b.id));
      let changed = 0;
      for (const v of variants) {
        const available = Math.max(0, Math.trunc(wanted.get(v.externalId ?? '') ?? 0));
        const current = await tx.inventory.lockStock(v.id, warehouse.id);
        const delta = available - (current?.onHand ?? 0);
        if (delta === 0) continue;
        await tx.inventory.apply(ws, [
          {
            variantId: v.id,
            warehouseId: warehouse.id,
            onHandDelta: delta,
            reservedDelta: 0,
            reason: 'adjust',
            refType: 'external',
            refId: null,
            actorUserId: null,
          },
        ]);
        changed += 1;
      }
      return changed;
    });
  }

  async importExternalImage(ws: WorkspaceId, url: string): Promise<string> {
    const { bytes, mime } = await this.download(url);
    return this.images.put(`products/${ws}/${newId()}.${EXTENSIONS[mime]}`, bytes, mime);
  }

  releaseExternalSource(ws: WorkspaceId, source: ExternalSource): Promise<number> {
    return this.store.run(ws, (tx) => tx.catalogSync.release(source));
  }

  countExternalProducts(ws: WorkspaceId, source: ExternalSource): Promise<number> {
    return this.store.run(ws, (tx) => tx.catalogSync.count(source));
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  /**
   * The Rapiz product to link the first time: the one product, not linked and not an
   * accommodation, whose live variants carry the item's SKUs.
   */
  async #adoptable(tx: CommerceTx, inputs: ExternalVariantInput[]): Promise<ProductRecord | null> {
    const live = (await tx.botOrders.variantsBySkus(inputs.map((v) => v.sku))).filter(
      (v) => !v.archived,
    );
    const [owner, ...others] = new Set(live.map((v) => v.productId));
    if (!owner || others.length) return null;
    const product = await tx.products.find(owner);
    return product && !product.external && !product.accommodation ? product : null;
  }

  /**
   * Variants matched by external id (an archived one comes back), then a live one by SKU;
   * unmatched inputs become new variants.
   */
  #matchVariants(
    productId: string,
    inputs: ExternalVariantInput[],
    variants: VariantRecord[],
  ): VariantRecord[] {
    const used = new Set<string>();
    const pick = (match: (v: VariantRecord) => boolean) => {
      const hit = variants.find((v) => !used.has(v.id) && match(v));
      if (hit) used.add(hit.id);
      return hit;
    };
    const byExternal = new Map(inputs.map((i) => [i, pick((v) => v.externalId === i.externalId)]));
    return inputs.map((input, position) => {
      const prior =
        byExternal.get(input) ?? pick((v) => !v.archived && fold(v.sku) === fold(input.sku));
      return {
        id: prior?.id ?? newId(),
        productId,
        sku: input.sku,
        name: input.name,
        price: Math.max(0, Math.round(input.price)),
        // The PMS sends no cost: a kept variant keeps the one staff entered.
        cost: prior?.cost ?? 0,
        weightGram: Math.max(0, Math.round(input.weightGram)),
        position,
        archived: false,
        externalId: input.externalId,
      };
    });
  }

  /** The first variant's SKU, or with `-KV<externalId>` appended when another product has it. */
  async #newCode(tx: CommerceTx, sku: string, externalId: string): Promise<string> {
    const base = sku || `KV${externalId}`;
    return (await tx.catalogSync.codeTaken(base)) ? `${base}-KV${externalId}` : base;
  }
}
