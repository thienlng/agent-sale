import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it } from 'vitest';

import type { PublicObjectStorage } from '../../../common/storage/public-object-storage.js';
import { CatalogService } from '../application/catalog.service.js';
import type {
  OrderItemRecord,
  ProductRecord,
  VariantRecord,
} from '../application/ports/commerce-store.js';
import { InMemoryCommerce } from './factories/in-memory-commerce.js';

const ws = workspaceId(newId());
const actor = newId();

function product(extra: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: newId(),
    code: 'SP01',
    name: 'Thú gỗ',
    description: '',
    category: null,
    status: 'active',
    visibleToBot: true,
    botInstructions: '',
    imageUrls: [],
    accommodation: null,
    external: null,
    searchText: '',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...extra,
  };
}

function variant(p: ProductRecord, extra: Partial<VariantRecord> = {}): VariantRecord {
  return {
    id: newId(),
    productId: p.id,
    sku: 'TG-01',
    name: '',
    price: 100_000,
    cost: 50_000,
    weightGram: 0,
    position: 0,
    archived: false,
    ...extra,
  };
}

function setup() {
  const db = new InMemoryCommerce();
  const p = product();
  const v = variant(p);
  db.products.push(p);
  db.variants.push(v);
  db.stock.push({ variantId: v.id, warehouseId: newId(), onHand: 3, reserved: 0 });
  db.botSelection.set('bot-1', [p.id]);
  const service = new CatalogService(db, {} as PublicObjectStorage);
  return { db, p, v, service };
}

const line = (variantId: string): OrderItemRecord => ({
  id: newId(),
  variantId,
  productName: 'Thú gỗ',
  variantName: '',
  sku: 'TG-01',
  qty: 1,
  unitPrice: 100_000,
  unitCost: 50_000,
  lineTotal: 100_000,
  position: 0,
});

describe('CatalogService.deleteProduct', () => {
  it('deletes an unordered product with its variants, stock and bot selection, and audits it', async () => {
    const { db, p, service } = setup();
    await service.deleteProduct(ws, p.id, actor);
    expect(db.products).toEqual([]);
    expect(db.variants).toEqual([]);
    expect(db.stock).toEqual([]);
    expect(db.botSelection.get('bot-1')).toEqual([]);
    expect(db.audits).toEqual([
      { actorUserId: actor, action: 'commerce.product.deleted', targetId: p.id },
    ]);
  });

  it('refuses a product an order uses with 409 product_in_orders', async () => {
    const { db, p, v, service } = setup();
    db.items.set(newId(), [line(v.id)]);
    expect(await service.deleteProduct(ws, p.id, actor).catch((e: unknown) => e)).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'product_in_orders' },
    });
    expect(db.products).toHaveLength(1);
    expect(db.audits).toEqual([]);
  });

  it('counts an order line of an archived variant too', async () => {
    const { db, p, service } = setup();
    const old = variant(p, { sku: 'TG-OLD', archived: true });
    db.variants.push(old);
    db.items.set(newId(), [line(old.id)]);
    expect(await service.deleteProduct(ws, p.id, actor).catch((e: unknown) => e)).toMatchObject({
      details: { reason: 'product_in_orders' },
    });
  });

  it('refuses a product synced from KiotViet with 409 product_synced', async () => {
    const { db, p, service } = setup();
    db.products[0] = { ...p, external: { source: 'kiotviet', id: '1001' } };
    expect(await service.deleteProduct(ws, p.id, actor).catch((e: unknown) => e)).toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'product_synced' },
    });
    expect(db.products).toHaveLength(1);
  });

  it('answers NOT_FOUND for a product outside the workspace or a malformed id', async () => {
    const { db, service } = setup();
    for (const id of [newId(), 'not-a-uuid']) {
      expect(await service.deleteProduct(ws, id, actor).catch((e: unknown) => e)).toMatchObject({
        code: 'NOT_FOUND',
      });
    }
    expect(db.products).toHaveLength(1);
  });
});
