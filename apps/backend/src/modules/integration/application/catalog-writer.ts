import { DomainError, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable } from '@nestjs/common';

import {
  CATALOG_SYNC_FACADE,
  type CatalogSyncFacade,
  ExternalImageError,
} from '../../commerce/api/index.js';
import {
  groupKvProducts,
  type KvProduct,
  type MappedItem,
  masterOf,
} from '../domain/kiotviet-mapping.js';
import { availableBySaleBranches } from '../domain/stock.js';
import { INTEGRATION_STORE, type IntegrationStore } from './ports/integration-store.js';
import {
  KIOTVIET_GATEWAY,
  type KiotVietGateway,
  type KvCredentials,
} from './ports/kiotviet-gateway.js';

export const SOURCE = 'kiotviet';

/** What one sync run counts while it writes (reported once at the end). */
export interface WriteStats {
  imagesFailed: number;
}

/** A catalog-write conflict from commerce (link race or code race): retry once, then skip. */
const isConflict = (e: unknown): boolean => e instanceof DomainError && e.code === 'CONFLICT';

/**
 * KiotViet products → commerce writes, shared by the full import, the reconcile and webhooks.
 * Every upsert is partial: a page or a webhook may carry only part of a product's group, and the
 * siblings it does not name must stay (removals arrive as ids, or from the full-import sweep).
 */
@Injectable()
export class CatalogWriter {
  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(KIOTVIET_GATEWAY) private readonly gateway: KiotVietGateway,
    @Inject(CATALOG_SYNC_FACADE) private readonly catalog: CatalogSyncFacade,
  ) {}

  /**
   * Groups the products by master, fetching each master missing from the set so the item carries
   * the master's fields and position 0. A group whose master no longer exists is dropped.
   */
  async group(creds: KvCredentials, products: KvProduct[]): Promise<MappedItem[]> {
    const present = new Set(products.map((p) => p.id));
    const missing = [...new Set(products.map(masterOf))].filter((id) => !present.has(id));
    const masters: KvProduct[] = [];
    const gone = new Set<number>();
    for (const id of missing) {
      const master = await this.gateway.productById(creds, id);
      if (master) masters.push(master);
      else gone.add(id);
    }
    return groupKvProducts([...masters, ...products]).filter(
      (item) => !gone.has(Number(item.externalId)),
    );
  }

  /** Imports the pictures and upserts one item; conflicts are logged, never thrown. */
  async write(
    ws: WorkspaceId,
    connectionId: string,
    item: MappedItem,
    stats: WriteStats,
  ): Promise<void> {
    const imageUrls = await this.images(ws, item.sourceImageUrls, stats);
    const input = {
      externalId: item.externalId,
      name: item.name,
      description: item.description,
      category: item.category,
      active: item.active,
      imageUrls,
      variants: item.variants,
    };
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await this.catalog.upsertExternalProduct(ws, SOURCE, input, { partial: true });
        // `applied: false` names its skipped SKUs; with none there is nothing to report.
        for (const sku of res.skipped) await this.conflict(ws, connectionId, sku);
        return;
      } catch (error) {
        if (!isConflict(error)) throw error;
        if (attempt >= 2) {
          await this.conflict(ws, connectionId, item.variants[0]?.sku ?? '');
          return;
        }
      }
    }
  }

  /** Stock rows for commerce: what the sale branches can sell of each KiotViet product. */
  stockRows(
    rows: ReadonlyArray<{ productId: number; inventories?: KvProduct['inventories'] }>,
    saleBranchIds: readonly number[],
  ): Array<{ externalVariantId: string; available: number }> {
    return rows
      .filter((r) => r.inventories !== undefined)
      .map((r) => ({
        externalVariantId: String(r.productId),
        available: availableBySaleBranches(r.inventories ?? [], saleBranchIds),
      }));
  }

  /** Cache first; a picture that cannot be imported is counted and left out. */
  private async images(ws: WorkspaceId, urls: string[], stats: WriteStats): Promise<string[]> {
    const out: string[] = [];
    for (const url of urls) {
      const cached = await this.store.cachedImage(ws, url);
      if (cached) {
        out.push(cached);
        continue;
      }
      try {
        const stored = await this.catalog.importExternalImage(ws, url);
        await this.store.cacheImage(ws, url, stored);
        out.push(stored);
      } catch (error) {
        if (!(error instanceof ExternalImageError)) throw error;
        stats.imagesFailed += 1;
      }
    }
    return out;
  }

  private conflict(ws: WorkspaceId, connectionId: string, sku: string): Promise<void> {
    return this.store.log(ws, connectionId, {
      level: 'warning',
      code: 'sku_conflict',
      params: { sku },
    });
  }
}
