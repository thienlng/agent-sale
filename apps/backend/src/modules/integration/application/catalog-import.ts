import { Inject, Injectable } from '@nestjs/common';

import { CATALOG_SYNC_FACADE, type CatalogSyncFacade } from '../../commerce/api/index.js';
import { CatalogWriter, SOURCE, type WriteStats } from './catalog-writer.js';
import { INTEGRATION_STORE, type IntegrationStore } from './ports/integration-store.js';
import { KIOTVIET_GATEWAY, type KiotVietGateway } from './ports/kiotviet-gateway.js';
import { addSorted, type ImportCursor, PAGE_SIZE, type SyncContext } from './sync-context.js';

/** What a finished run reports back to the job runner. */
export interface ImportOutcome {
  products: number;
  imagesFailed: number;
}

/**
 * The page loops of a full import or reconcile (spec §5.3): products, then stock at the sale
 * branches, then (full only, when every page was read) archiving what KiotViet no longer has.
 * The cursor is saved after every page, so a restart resumes at the next one.
 */
@Injectable()
export class CatalogImport {
  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(KIOTVIET_GATEWAY) private readonly gateway: KiotVietGateway,
    @Inject(CATALOG_SYNC_FACADE) private readonly catalog: CatalogSyncFacade,
    @Inject(CatalogWriter) private readonly writer: CatalogWriter,
  ) {}

  async run(ctx: SyncContext, cursor: ImportCursor): Promise<ImportOutcome> {
    if (cursor.phase === 'products') cursor = await this.products(ctx, cursor);
    if (cursor.phase === 'stock') cursor = await this.stock(ctx, cursor);
    await ctx.live();
    if (cursor.mode === 'full' && !cursor.incomplete) await this.sweep(ctx, cursor);
    return {
      products: await this.catalog.countExternalProducts(ctx.ws, SOURCE),
      imagesFailed: cursor.imagesFailed,
    };
  }

  private async products(ctx: SyncContext, start: ImportCursor): Promise<ImportCursor> {
    const cursor = { ...start };
    const since = cursor.since ? new Date(cursor.since) : undefined;
    for (;;) {
      await ctx.live();
      const page = await this.gateway.products(ctx.creds, {
        currentItem: cursor.currentItem,
        pageSize: PAGE_SIZE,
        // Stock comes from the on-hands phase.
        includeInventory: false,
        ...(since ? { lastModifiedFrom: since } : {}),
      });
      const items = await this.writer.group(ctx.creds, page.data);
      await ctx.live();
      const stats: WriteStats = { imagesFailed: 0 };
      for (const item of items) await this.writer.write(ctx.ws, ctx.connection.id, item, stats);
      if (page.removedIds.length) {
        await this.catalog.removeExternalProducts(ctx.ws, SOURCE, page.removedIds.map(String));
      }

      const expected = Math.min(PAGE_SIZE, Math.max(0, page.total - cursor.currentItem));
      cursor.incomplete ||= page.data.length < expected;
      cursor.imagesFailed += stats.imagesFailed;
      if (cursor.mode === 'full') {
        cursor.seenProducts = addSorted(
          cursor.seenProducts,
          items.map((i) => Number(i.externalId)),
        );
        cursor.seenVariants = addSorted(
          cursor.seenVariants,
          items.flatMap((i) => i.variants.map((v) => Number(v.externalId))),
        );
      }
      cursor.currentItem += PAGE_SIZE;
      const done = cursor.currentItem >= page.total;
      if (cursor.mode === 'full') {
        await this.progress(ctx, 'products', Math.min(cursor.currentItem, page.total), page.total);
      }
      if (done) Object.assign(cursor, { phase: 'stock', currentItem: 0 });
      await ctx.checkpoint(cursor);
      if (done) return cursor;
    }
  }

  private async stock(ctx: SyncContext, start: ImportCursor): Promise<ImportCursor> {
    const cursor = { ...start };
    const since = cursor.since ? new Date(cursor.since) : undefined;
    for (;;) {
      await ctx.live();
      const page = await this.gateway.onHands(ctx.creds, {
        currentItem: cursor.currentItem,
        pageSize: PAGE_SIZE,
        branchIds: cursor.saleBranchIds,
        ...(since ? { lastModifiedFrom: since } : {}),
      });
      const rows = this.writer.stockRows(page.data, cursor.saleBranchIds);
      await ctx.live();
      await this.catalog.setExternalStock(ctx.ws, SOURCE, rows);

      cursor.currentItem += PAGE_SIZE;
      const done = cursor.currentItem >= page.total;
      if (cursor.mode === 'full') {
        await this.progress(ctx, 'stock', Math.min(cursor.currentItem, page.total), page.total);
      }
      if (done) Object.assign(cursor, { phase: 'finish', currentItem: 0 });
      await ctx.checkpoint(cursor);
      if (done) return cursor;
    }
  }

  /**
   * Archives linked products and variants the completed full import did not see, and the unlinked
   * variants left on linked products.
   */
  private async sweep(ctx: SyncContext, cursor: ImportCursor): Promise<void> {
    const linked = await this.catalog.linkedExternalIds(ctx.ws, SOURCE);
    const products = new Set(cursor.seenProducts.map(String));
    const variants = new Set(cursor.seenVariants.map(String));
    const stale = [
      ...linked.products.filter((id) => !products.has(id)),
      ...linked.variants.filter((id) => !variants.has(id)),
    ];
    if (stale.length) {
      await this.catalog.removeExternalProducts(ctx.ws, SOURCE, [...new Set(stale)]);
    }
    // Every KiotViet variant now carries its link: Rapiz-only variants of adopted products go.
    await this.catalog.archiveUnlinkedVariants(ctx.ws, SOURCE);
  }

  private async progress(ctx: SyncContext, phase: string, done: number, total: number) {
    await this.store.updateConnection(ctx.ws, ctx.connection.id, {
      progress: { phase, done, total },
    });
  }
}
