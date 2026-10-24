import type { ProductDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

/** Read-only active catalog visible to the bot; prices are authoritative integer VND. */
export interface CatalogFacade {
  getBotProducts(workspaceId: WorkspaceId, query: string, limit: number): Promise<ProductDto[]>;
  /** The newest active products the bot may mention, for general questions ("what do you sell?"). */
  listBotCatalog(workspaceId: WorkspaceId, limit: number): Promise<ProductDto[]>;
}

export const CATALOG_FACADE = Symbol('CATALOG_FACADE');
