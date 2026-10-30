import type { ProductDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** Which products a bot may offer: every active one, or only those selected for it (T-080). */
export interface BotCatalogScope {
  botId: string;
  catalogMode: 'all' | 'selected';
}

/** Read-only active catalog visible to the bot; prices are authoritative integer VND. */
export interface CatalogFacade {
  getBotProducts(
    workspaceId: WorkspaceId,
    bot: BotCatalogScope,
    query: string,
    limit: number,
  ): Promise<ProductDto[]>;
  /**
   * Ranked search over the products the bot may offer (accent-insensitive, typo-tolerant). Without a
   * query: every such product by name. `limit` is capped at 300.
   */
  searchBotCatalog(
    workspaceId: WorkspaceId,
    bot: BotCatalogScope,
    input: { query?: string; maxPriceVnd?: number; inStockOnly?: boolean; limit: number },
  ): Promise<ProductDto[]>;
  /** In-scope products for these ids, in the order of `ids`; unknown or out-of-scope ids are skipped (max 10). */
  getBotProductsByIds(
    workspaceId: WorkspaceId,
    bot: BotCatalogScope,
    ids: readonly string[],
  ): Promise<ProductDto[]>;
  /** How many products the bot may offer. */
  countBotCatalog(workspaceId: WorkspaceId, bot: BotCatalogScope): Promise<number>;
  /** The newest active products the bot may mention, for general questions ("what do you sell?"). */
  listBotCatalog(
    workspaceId: WorkspaceId,
    bot: BotCatalogScope,
    limit: number,
  ): Promise<ProductDto[]>;
}

export const CATALOG_FACADE = Symbol('CATALOG_FACADE');
