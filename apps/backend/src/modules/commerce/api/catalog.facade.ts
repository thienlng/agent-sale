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
  /** The newest active products the bot may mention, for general questions ("what do you sell?"). */
  listBotCatalog(
    workspaceId: WorkspaceId,
    bot: BotCatalogScope,
    limit: number,
  ): Promise<ProductDto[]>;
}

export const CATALOG_FACADE = Symbol('CATALOG_FACADE');
