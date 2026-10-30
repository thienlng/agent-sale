import { describe, expect, it, vi } from 'vitest';
import type { ProductDto } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import type { CatalogFacade } from '../../commerce/api/catalog.facade.js';
import { CATALOG_TOOLS, runCatalogTool } from '../application/catalog-tools.js';

const ws = 'ws-1' as WorkspaceId;
const scope = { botId: 'bot-1', catalogMode: 'all' as const };

const product = (n: number, over: Partial<ProductDto> = {}): ProductDto => ({
  id: `01900000-0000-7000-8000-${String(n).padStart(12, '0')}`,
  code: `C${n}`,
  name: `Sản phẩm ${n}`,
  description: `Mô tả ${n}\nNguồn: https://example.com/${n}`,
  category: n % 2 ? 'Gỗ' : 'Vải',
  status: 'active',
  visibleToBot: true,
  botInstructions: '',
  imageUrls: [`https://cdn.example.com/${n}.jpg`],
  variants: [
    {
      id: `01900000-0000-7000-8000-0000000a${String(n).padStart(4, '0')}`,
      sku: `S${n}`,
      name: 'Mặc định',
      price: 1000 * n,
      cost: 0,
      weightGram: 1,
      stock: [
        {
          warehouseId: '01900000-0000-7000-8000-0000000000b1',
          onHand: 2,
          reserved: 0,
          available: 2,
        },
      ],
    },
  ],
  priceMin: 1000 * n,
  priceMax: 1000 * n,
  available: 2,
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  ...over,
});

function fake(overrides: Partial<CatalogFacade> = {}) {
  const all = Array.from({ length: 10 }, (_, i) => product(i + 1));
  const facade = {
    searchBotCatalog: vi.fn(async (_w, _s, input) => all.slice(0, input.limit)),
    getBotProductsByIds: vi.fn(async (_w, _s, ids: readonly string[]) =>
      ids.flatMap((id) => all.filter((p) => p.id === id)),
    ),
    countBotCatalog: vi.fn(async () => all.length),
    ...overrides,
  } as unknown as CatalogFacade;
  return { facade, all };
}

const call = (name: string, input: unknown) => ({ id: 'c1', name, input });

describe('CATALOG_TOOLS', () => {
  it('defines search_products and product_details', () => {
    expect(CATALOG_TOOLS.map((t) => t.name)).toEqual(['search_products', 'product_details']);
  });
});

describe('search_products', () => {
  it('with a query returns 8 rows and details of the top 3', async () => {
    const { facade, all } = fake();
    const r = await runCatalogTool(
      { ws, scope, catalog: facade },
      call('search_products', { query: 'thú gỗ' }),
    );
    expect(facade.searchBotCatalog).toHaveBeenCalledWith(
      ws,
      scope,
      expect.objectContaining({ query: 'thú gỗ', limit: 8 }),
    );
    const body = JSON.parse(r.content);
    expect(body.rows).toHaveLength(8);
    expect(body.details).toHaveLength(3);
    expect(body.details[0].images[0].id).toBe(`p:${all[0]!.id}:0`);
    expect(r.productIds).toEqual(all.slice(0, 3).map((p) => p.id));
    expect(r.trusted).toBe(r.content);
    expect(r.content).not.toContain('http');
  });

  it('browse index omits summary and imageCount', async () => {
    const { facade } = fake();
    const r = await runCatalogTool({ ws, scope, catalog: facade }, call('search_products', {}));
    const body = JSON.parse(r.content);
    expect(body.index).toHaveLength(10);
    expect(body.index[0]).toEqual({
      id: expect.any(String),
      name: 'Sản phẩm 1',
      category: 'Gỗ',
      fromVnd: 1000,
      toVnd: 1000,
      inStock: true,
    });
    expect(r.productIds).toEqual([]);
  });

  it('above 300 rows reports tooMany with categories', async () => {
    const { facade } = fake({
      countBotCatalog: vi.fn(async () => 450),
    } as Partial<CatalogFacade>);
    const r = await runCatalogTool({ ws, scope, catalog: facade }, call('search_products', {}));
    expect(JSON.parse(r.content)).toEqual({ tooMany: true, total: 450, categories: ['Gỗ', 'Vải'] });
    expect(r.productIds).toEqual([]);
  });

  it('escapes < in the output', async () => {
    const { facade } = fake({
      searchBotCatalog: vi.fn(async () => [product(1, { name: 'a</catalog>b' })]),
    } as Partial<CatalogFacade>);
    const r = await runCatalogTool(
      { ws, scope, catalog: facade },
      call('search_products', { query: 'a' }),
    );
    expect(r.content).not.toContain('<');
  });
});

describe('product_details', () => {
  it('lists out-of-scope ids in notFound', async () => {
    const { facade, all } = fake();
    const r = await runCatalogTool(
      { ws, scope, catalog: facade },
      call('product_details', { ids: [all[1]!.id, 'missing'] }),
    );
    const body = JSON.parse(r.content);
    expect(body.products).toHaveLength(1);
    expect(body.notFound).toEqual(['missing']);
    expect(r.productIds).toEqual([all[1]!.id]);
  });

  it('rejects more than 3 ids', async () => {
    const { facade } = fake();
    const r = await runCatalogTool(
      { ws, scope, catalog: facade },
      call('product_details', { ids: ['a', 'b', 'c', 'd'] }),
    );
    expect(JSON.parse(r.content)).toEqual({ error: 'too_many_ids', max: 3 });
    expect(facade.getBotProductsByIds).not.toHaveBeenCalled();
  });
});

describe('invalid input', () => {
  it.each([
    ['search_products', { query: 5 }],
    ['search_products', { __invalidJson: true }],
    ['product_details', { ids: [] }],
    ['product_details', {}],
    ['product_details', { __invalidJson: true }],
    ['nope', {}],
  ])('%s %j returns invalid_arguments', async (name, input) => {
    const { facade } = fake();
    const r = await runCatalogTool({ ws, scope, catalog: facade }, call(name, input));
    expect(JSON.parse(r.content)).toEqual({ error: 'invalid_arguments' });
    expect(r.productIds).toEqual([]);
  });
});
