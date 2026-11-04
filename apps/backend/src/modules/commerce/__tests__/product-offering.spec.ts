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
const offering = {
  kind: 'service' as const,
  durationMinutes: 60,
  sessions: null,
  period: '',
  format: null,
  level: '',
  schedule: '',
  audience: '',
  outcomes: [],
  priceNote: 'liên hệ',
};

const record = (id: string, patch: Partial<ProductRecord> = {}): ProductRecord => ({
  id,
  code: id,
  name: id,
  description: '',
  category: null,
  status: 'active',
  visibleToBot: true,
  botInstructions: '',
  imageUrls: [],
  accommodation: null,
  offering: null,
  external: null,
  searchText: id,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...patch,
});

const variant = (productId: string): VariantRecord => ({
  id: newId(),
  productId,
  sku: productId,
  name: '',
  price: 0,
  cost: 0,
  weightGram: 0,
  position: 0,
  archived: false,
});

function service(rows: ProductRecord[]) {
  const saved: ProductRecord[] = [];
  const tx = {
    products: {
      searchForBot: async () => rows,
      find: async (id: string) => rows.find((r) => r.id === id) ?? null,
      variantsOf: async (ids: string[]) => ids.map(variant),
      save: async (p: ProductRecord) => void saved.push(p),
    },
    inventory: { stockOf: async () => [] },
  };
  const store = { run: async (_ws: unknown, fn: (t: unknown) => unknown) => fn(tx) };
  const images = { isPublicUrlUnder: () => false } as unknown as ConstructorParameters<
    typeof CatalogService
  >[1];
  return { svc: new CatalogService(store as unknown as CommerceStore, images), saved };
}

describe('product offerings (T-187)', () => {
  it('keeps a course or a service in an in-stock-only bot search: it has no stock', async () => {
    const { svc } = service([record('facial', { offering }), record('cream')]);
    const found = await svc.searchBotCatalog(ws, scope, { inStockOnly: true, limit: 8 });
    expect(found.map((p) => [p.id, p.offering?.kind ?? null])).toEqual([['facial', 'service']]);
  });

  it('refuses an offering on a stored accommodation, before writing anything', async () => {
    const id = newId();
    const villa = record(id, {
      accommodation: { rentalType: 'entire_property', gallery: [] } as never,
    });
    const { svc, saved } = service([villa]);
    const err = await svc
      .updateProduct(ws, id, {
        code: id,
        name: 'Villa',
        variants: [{ sku: 'V-1', price: 1 }],
        offering,
      } as never)
      .then(
        () => null,
        (e: unknown) => e as { code: string },
      );
    expect(err?.code).toBe('VALIDATION_FAILED');
    expect(saved).toHaveLength(0);
  });
});
