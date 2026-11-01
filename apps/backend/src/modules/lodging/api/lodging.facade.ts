import type { ProductDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** PUBLIC CONTRACT of the lodging module. Use-case shaped, returns DTOs from packages/contracts. */
export interface LodgingFacade {
  /** The properties a bot sells: its stored selection, or every active property when it has none. */
  listBotPropertyIds(workspaceId: WorkspaceId, botId: string): Promise<string[]>;
}

export const LODGING_FACADE = Symbol('LODGING_FACADE');

/** The bot whose catalog is read; any other field (e.g. the commerce `catalogMode`) is ignored. */
export interface LodgingBotScope {
  botId: string;
}

/**
 * The bot catalog of a hotel business, read from lodging properties (T-160). Same method shapes as
 * the commerce `CatalogFacade`, so the `ai` module uses it in its place for hotel bots. Each active
 * property the bot sells (lodging_bot_properties; no rows = every active property) is one
 * `ProductDto` with `id` = property id and an `accommodation` built from the property. Only sell
 * prices: never a cost. A property whose weekdays are not all priced is left out.
 */
export interface LodgingCatalogFacade {
  /** Accent-insensitive match on code, name, area and amenities; `inStockOnly` is ignored. */
  searchBotCatalog(
    workspaceId: WorkspaceId,
    bot: LodgingBotScope,
    input: { query?: string; maxPriceVnd?: number; inStockOnly?: boolean; limit: number },
  ): Promise<ProductDto[]>;
  /** Properties for these ids, in the order of `ids`; unknown or out-of-scope ids are skipped (max 10). */
  getBotProductsByIds(
    workspaceId: WorkspaceId,
    bot: LodgingBotScope,
    ids: readonly string[],
  ): Promise<ProductDto[]>;
  countBotCatalog(workspaceId: WorkspaceId, bot: LodgingBotScope): Promise<number>;
}

export const LODGING_CATALOG_FACADE = Symbol('LODGING_CATALOG_FACADE');
