import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import { CatalogService } from '../application/catalog.service.js';
import type {
  CommerceStore,
  ProductRecord,
  VariantRecord,
} from '../application/ports/commerce-store.js';

const ws = workspaceId(newId());
const scope = { botId: newId(), catalogMode: 'all' as const };

const record = (id: string, accommodation: boolean): ProductRecord =>
  ({
    id,
    code: id,
    name: id,
    description: '',
    category: null,
    status: 'active',
    visibleToBot: true,
    botInstructions: '',
    imageUrls: [],
    accommodation: accommodation ? { rentalType: 'entire_property' } : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  }) as unknown as ProductRecord;

const variant = (productId: string, price: number): VariantRecord =>
  ({
    id: `${productId}-v`,
    productId,
    sku: productId,
    name: '',
    price,
    cost: null,
    weightGram: null,
    position: 0,
    archived: false,
  }) as unknown as VariantRecord;

/** A store with one villa (no stock, 5,000,000) and one toy (no stock, 100,000). */
function service() {
  const calls: Array<{ terms: string[]; limit: number }> = [];
  const rows = [record('villa', true), record('toy', false)];
  const tx = {
    products: {
      searchForBot: async (f: { terms: string[]; limit: number }) => {
        calls.push(f);
        return rows;
      },
      variantsOf: async () => [variant('villa', 5_000_000), variant('toy', 100_000)],
    },
    inventory: { stockOf: async () => [] },
  };
  const store = { run: async (_ws: unknown, fn: (t: unknown) => unknown) => fn(tx) };
  // Image storage is irrelevant to catalog search; any URL check would say "not ours".
  const images = { isPublicUrlUnder: () => false } as unknown as ConstructorParameters<
    typeof CatalogService
  >[1];
  return { svc: new CatalogService(store as unknown as CommerceStore, images), calls };
}

describe('bot catalog search filters', () => {
  it('exempts accommodations from the stock and price filters', async () => {
    const { svc } = service();
    const inStock = await svc.searchBotCatalog(ws, scope, { inStockOnly: true, limit: 8 });
    expect(inStock.map((p) => p.id)).toEqual(['villa']);
    const cheap = await svc.searchBotCatalog(ws, scope, { maxPriceVnd: 200_000, limit: 8 });
    expect(cheap.map((p) => p.id)).toEqual(['villa', 'toy']);
    const none = await svc.searchBotCatalog(ws, scope, {
      inStockOnly: true,
      maxPriceVnd: 10,
      limit: 8,
    });
    expect(none.map((p) => p.id)).toEqual(['villa']);
  });

  it('returns nothing, without querying, for a query with no usable term', async () => {
    const { svc, calls } = service();
    expect(await svc.searchBotCatalog(ws, scope, { query: 'a', limit: 8 })).toEqual([]);
    expect(await svc.searchBotCatalog(ws, scope, { query: ' ?! ', limit: 8 })).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(await svc.searchBotCatalog(ws, scope, { limit: 8 })).toHaveLength(2);
    expect(await svc.searchBotCatalog(ws, scope, { query: '  ', limit: 8 })).toHaveLength(2);
  });
});
