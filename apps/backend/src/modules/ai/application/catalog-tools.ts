import { z } from 'zod';
import { INVALID_JSON_INPUT_KEY, type ToolCall, type ToolDefinition } from '@agent-sales/ai-core';
import type { ProductDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';

import type { BotCatalogScope, CatalogFacade } from '../../commerce/api/catalog.facade.js';
import { compactProduct, productDetails } from '../domain/product-view.js';
import { safeJson } from './action-tools.js';

export interface ToolResult {
  /** The JSON the model receives. */
  content: string;
  /** Grounding text: figures in it may be quoted in the reply. */
  trusted: string;
  /** Products whose details the model received (focus products, image allowlist). */
  productIds: string[];
}

export interface CatalogToolContext {
  ws: WorkspaceId;
  scope: BotCatalogScope;
  catalog: CatalogFacade;
}

const SEARCH_ROWS = 8;
const DETAIL_ROWS = 3;
const BROWSE_CAP = 300;
const MAX_CATEGORIES = 50;
const MAX_IDS = 3;

const SearchInput = z.object({
  query: z.string().trim().max(200).optional(),
  maxPriceVnd: z.number().int().positive().optional(),
  inStockOnly: z.boolean().optional(),
});
const DetailsInput = z.object({
  ids: z.array(z.string().trim().min(1).max(64)).min(1),
});

export const CATALOG_TOOLS: ToolDefinition[] = [
  {
    name: 'search_products',
    description:
      'Search the shop catalog. With a query (keywords you choose, any language) returns up to 8 ranked products and the full details of the top 3. Without a query returns the compact list of every product (or the categories when the catalog is too large). Search before saying the shop lacks something; try other keywords.',
    input: SearchInput,
  },
  {
    name: 'product_details',
    description:
      'Full details (description, variants, prices, stock, pictures) of 1 to 3 products by the ids returned by earlier results.',
    input: DetailsInput,
  },
];

const done = (value: unknown, productIds: string[] = []): ToolResult => {
  const content = safeJson(value);
  return { content, trusted: content, productIds };
};
const invalid = (): ToolResult => done({ error: 'invalid_arguments' });

const isInvalidJson = (input: unknown): boolean =>
  typeof input === 'object' && input !== null && INVALID_JSON_INPUT_KEY in input;

async function search(ctx: CatalogToolContext, input: z.infer<typeof SearchInput>) {
  const { ws, scope, catalog } = ctx;
  const filters = {
    ...(input.maxPriceVnd !== undefined ? { maxPriceVnd: input.maxPriceVnd } : {}),
    ...(input.inStockOnly !== undefined ? { inStockOnly: input.inStockOnly } : {}),
  };
  if (input.query) {
    const rows = await catalog.searchBotCatalog(ws, scope, {
      query: input.query,
      ...filters,
      limit: SEARCH_ROWS,
    });
    const top = rows.slice(0, DETAIL_ROWS);
    return done(
      { rows: rows.map(compactProduct), details: top.map(productDetails) },
      top.map((p) => p.id),
    );
  }
  const filtered = input.maxPriceVnd !== undefined || input.inStockOnly !== undefined;
  const total = filtered ? undefined : await catalog.countBotCatalog(ws, scope);
  if (total !== undefined && total <= BROWSE_CAP) {
    return browse(await catalog.searchBotCatalog(ws, scope, { ...filters, limit: BROWSE_CAP }));
  }
  const rows = await catalog.searchBotCatalog(ws, scope, { ...filters, limit: BROWSE_CAP });
  if (total === undefined && rows.length < BROWSE_CAP) return browse(rows);
  return done({
    tooMany: true,
    // The count ignores the filters, so it is only meaningful for an unfiltered browse.
    ...(total !== undefined ? { total } : {}),
    categories: [...new Set(rows.map((p) => p.category?.trim()).filter((c): c is string => !!c))]
      .sort()
      .slice(0, MAX_CATEGORIES),
  });
}

function browse(rows: ProductDto[]): ToolResult {
  const index = rows.map((p) => {
    const { summary: _s, imageCount: _i, ...row } = compactProduct(p);
    return row;
  });
  return done({ index });
}

async function details(ctx: CatalogToolContext, ids: string[]) {
  if (ids.length > MAX_IDS) return done({ error: 'too_many_ids', max: MAX_IDS });
  const found = await ctx.catalog.getBotProductsByIds(ctx.ws, ctx.scope, ids);
  const foundIds = new Set(found.map((p) => p.id));
  return done(
    { products: found.map(productDetails), notFound: ids.filter((id) => !foundIds.has(id)) },
    found.map((p) => p.id),
  );
}

/** Runs one catalog tool call; workspace and scope come from the server, never from the model. */
export async function runCatalogTool(ctx: CatalogToolContext, call: ToolCall): Promise<ToolResult> {
  if (isInvalidJson(call.input)) return invalid();
  if (call.name === 'search_products') {
    const parsed = SearchInput.safeParse(call.input);
    return parsed.success ? search(ctx, parsed.data) : invalid();
  }
  if (call.name === 'product_details') {
    const parsed = DetailsInput.safeParse(call.input);
    return parsed.success ? details(ctx, parsed.data.ids) : invalid();
  }
  return invalid();
}
