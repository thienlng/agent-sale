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
  /** The linked (or adopted, or new) product; null when nothing was created. */
  productId: string | null;
  created: boolean;
  /**
   * False when no input variant could be kept (every SKU is another product's, or the item has
   * none): nothing was written — no product is created and a linked one stays as it was.
   */
  applied: boolean;
  /** Input SKUs not linked because a live variant of another product already uses them. */
  skipped: string[];
}

export interface UpsertExternalProductOptions {
  /**
   * The item names only some of the product's variants (a PMS page or webhook carried part of the
   * group): live variants missing from it are kept, not archived. Moved variants are still handled.
   */
  partial?: boolean;
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
   * the item are archived. Name, description, category and variant names are cut to the product
   * form's limits; codes and SKUs are kept verbatim (they are match keys). Serialized per
   * (workspace, source, externalId); throws ExternalLinkConflictError on a lost race (retry).
   */
  upsertExternalProduct(
    ws: WorkspaceId,
    source: ExternalSource,
    item: ExternalCatalogItem,
    opts?: UpsertExternalProductOptions,
  ): Promise<UpsertExternalProductResult>;
  /**
   * Archives the linked products whose own external id is listed, and the linked variants (of the
   * source's products) whose external id is listed; returns how many rows changed.
   */
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
  /** External ids of the source's active linked products and of their live linked variants. */
  linkedExternalIds(
    ws: WorkspaceId,
    source: ExternalSource,
  ): Promise<{ products: string[]; variants: string[] }>;
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

/**
 * Another transaction linked the same external id at the same moment (a unique link index
 * refused the row). Nothing was written; retrying the call is safe.
 */
export class ExternalLinkConflictError extends DomainError {
  readonly code = 'CONFLICT';
  readonly retryable = true;
  constructor(constraint: string) {
    super('The product was linked by a concurrent sync; retry', {
      reason: 'EXTERNAL_LINK_RACE',
      constraint,
    });
  }
}
