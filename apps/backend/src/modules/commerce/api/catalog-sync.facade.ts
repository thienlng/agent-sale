import { DomainError, type WorkspaceId } from '@agent-sales/shared';

/** PMS a product can be synced from (ADR-017). */
export type ExternalSource = 'kiotviet';

export interface ExternalVariantInput {
  externalId: string;
  sku: string;
  name: string;
  /** Integer VND. */
  price: number;
  weightGram: number;
  position: number;
}

export interface ExternalCatalogItem {
  externalId: string;
  name: string;
  description: string;
  category: string | null;
  active: boolean;
  /** Already Rapiz-stored URLs (see `importExternalImage`). */
  imageUrls: string[];
  /** At least one. */
  variants: ExternalVariantInput[];
}

export interface UpsertExternalProductResult {
  productId: string;
  created: boolean;
  /** Input SKUs not linked because a live variant of another product already uses them. */
  skipped: string[];
}

/**
 * System-of-record writes of a PMS sync (the `integration` module). Every call runs in one tenant
 * transaction; Rapiz-owned fields (`visibleToBot`, `botInstructions`, the bot selection,
 * `accommodation`) are never written.
 */
export interface CatalogSyncFacade {
  /** Codes of the store vs the catalog: how many match an existing SKU, are new, or stay Rapiz-only. */
  previewExternalMatch(
    ws: WorkspaceId,
    codes: string[],
  ): Promise<{ matched: number; created: number; rapizOnly: number }>;
  /**
   * Creates or updates one product by its external id; the first time, adopts the Rapiz product
   * whose variants carry the item's SKUs (case-insensitive). Variants of the product missing from
   * the item are archived.
   */
  upsertExternalProduct(
    ws: WorkspaceId,
    source: ExternalSource,
    item: ExternalCatalogItem,
  ): Promise<UpsertExternalProductResult>;
  /** Archives the linked products with these external ids; returns how many changed. */
  removeExternalProducts(
    ws: WorkspaceId,
    source: ExternalSource,
    externalIds: string[],
  ): Promise<number>;
  /** Sets on-hand at the default warehouse (one `adjust` movement per change); returns the changes. */
  setExternalStock(
    ws: WorkspaceId,
    source: ExternalSource,
    rows: Array<{ externalVariantId: string; available: number }>,
  ): Promise<number>;
  /** Copies a picture into Rapiz storage and returns its URL; throws ExternalImageError. */
  importExternalImage(ws: WorkspaceId, url: string): Promise<string>;
  /** Clears the links of every product and variant of the source; returns the products released. */
  releaseExternalSource(ws: WorkspaceId, source: ExternalSource): Promise<number>;
  countExternalProducts(ws: WorkspaceId, source: ExternalSource): Promise<number>;
}

export const CATALOG_SYNC_FACADE = Symbol('CATALOG_SYNC_FACADE');

/**
 * A PMS picture could not be imported. `reason` is short and PII-free (`unsupported_format`,
 * `too_large`, `timeout`, `http_404`, …), never the URL.
 */
export class ExternalImageError extends DomainError {
  readonly code = 'VALIDATION_FAILED';
  constructor(readonly reason: string) {
    super('The picture could not be imported', { reason });
  }
}
