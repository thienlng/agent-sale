import { describe, expect, it, vi } from 'vitest';
import { AccommodationDetails, type ProductDto } from '@agent-sales/contracts';
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

describe('filters and browse paths', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => product(i + 1));

  it('forwards filters to the facade', async () => {
    const { facade } = fake();
    await runCatalogTool(
      { ws, scope, catalog: facade },
      call('search_products', { query: 'gỗ', maxPriceVnd: 5000, inStockOnly: true }),
    );
    expect(facade.searchBotCatalog).toHaveBeenCalledWith(ws, scope, {
      query: 'gỗ',
      maxPriceVnd: 5000,
      inStockOnly: true,
      limit: 8,
    });
  });

  it('filtered browse under 300 rows returns an index', async () => {
    const { facade } = fake();
    const r = await runCatalogTool(
      { ws, scope, catalog: facade },
      call('search_products', { maxPriceVnd: 5000 }),
    );
    expect(facade.searchBotCatalog).toHaveBeenCalledWith(ws, scope, {
      maxPriceVnd: 5000,
      limit: 300,
    });
    expect(JSON.parse(r.content).index).toHaveLength(10);
  });

  it('filtered browse that fills 300 rows is tooMany without a misleading total', async () => {
    const { facade } = fake({
      searchBotCatalog: vi.fn(async () => many(300)),
    } as Partial<CatalogFacade>);
    const r = await runCatalogTool(
      { ws, scope, catalog: facade },
      call('search_products', { inStockOnly: true }),
    );
    const body = JSON.parse(r.content);
    expect(body.tooMany).toBe(true);
    expect(body).not.toHaveProperty('total');
  });

  it('sorts categories and caps them at 50', async () => {
    const rows = Array.from({ length: 300 }, (_, i) =>
      product(i + 1, { category: i < 60 ? `Cat ${String(59 - i).padStart(2, '0')}` : null }),
    );
    const { facade } = fake({
      countBotCatalog: vi.fn(async () => 400),
      searchBotCatalog: vi.fn(async () => rows),
    } as Partial<CatalogFacade>);
    const r = await runCatalogTool({ ws, scope, catalog: facade }, call('search_products', {}));
    const body = JSON.parse(r.content);
    expect(body.total).toBe(400);
    expect(body.categories).toHaveLength(50);
    expect(body.categories[0]).toBe('Cat 00');
    expect(body.categories[49]).toBe('Cat 49');
  });

  it('returns the lodging shape for an accommodation without URLs', async () => {
    const lodging = product(1, {
      imageUrls: [],
      accommodation: AccommodationDetails.parse({
        rentalType: 'entire_property',
        bedrooms: 1,
        standardAdults: 2,
        standardChildren: 1,
        childAgeBelow: 6,
        maxGuests: null,
        roomLayout: [{ name: 'Room', beds: 'One bed' }],
        amenities: [],
        rateBasis: 'unconfirmed',
        rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 100000 }],
        gallery: [{ url: 'https://img.example.test/a.jpg', caption: 'Phòng khách' }],
      }),
    });
    const { facade } = fake({
      getBotProductsByIds: vi.fn(async () => [lodging]),
    } as Partial<CatalogFacade>);
    const r = await runCatalogTool(
      { ws, scope, catalog: facade },
      call('product_details', { ids: [lodging.id] }),
    );
    const d = JSON.parse(r.content).products[0];
    expect(d).toMatchObject({ catalogKind: 'accommodation', availability: 'unverified' });
    expect(d).not.toHaveProperty('inStock');
    expect(d.images).toEqual([{ id: `p:${lodging.id}:0`, label: `${lodging.name} – Phòng khách` }]);
    expect(r.content).not.toContain('http');
  });
});
