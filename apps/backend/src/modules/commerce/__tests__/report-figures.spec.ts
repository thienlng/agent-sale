import { newId, workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import type { IdentityFacade } from '../../identity/api/index.js';
import type { WorkspaceFacade } from '../../workspace/api/index.js';
import type { BotOrderService } from '../application/bot-order.service.js';
import { CommerceFacadeImpl } from '../application/commerce.facade.impl.js';
import { OrderService } from '../application/order.service.js';
import type {
  OrderRecord,
  ProductRecord,
  VariantRecord,
} from '../application/ports/commerce-store.js';
import { InMemoryCommerce } from './factories/in-memory-commerce.js';

/** Owner report figures on the commerce facade (T-172), against the in-memory store. */
const ws = workspaceId(newId());

function setup() {
  const db = new InMemoryCommerce();
  const identity = { displayName: vi.fn(async () => null) } as unknown as IdentityFacade;
  const workspaces = {
    getById: async () => ({ timezone: 'Asia/Ho_Chi_Minh' }),
  } as unknown as WorkspaceFacade;
  const orders = new OrderService(db, identity, workspaces);
  const facade = new CommerceFacadeImpl(orders, {} as BotOrderService);
  return { db, facade };
}

const order = (code: string, placedAt: string, over: Partial<OrderRecord> = {}): OrderRecord =>
  ({
    id: newId(),
    code,
    status: 'new',
    source: 'facebook',
    total: 100_000,
    placedAt: new Date(placedAt),
    customer: { name: 'Lan', phone: '0912345678' },
    ...over,
  }) as OrderRecord;

const product = (name: string, status: ProductRecord['status'] = 'active'): ProductRecord =>
  ({ id: newId(), name, status }) as ProductRecord;
const variant = (p: ProductRecord, sku: string, over: Partial<VariantRecord> = {}): VariantRecord =>
  ({ id: newId(), productId: p.id, sku, name: '', archived: false, ...over }) as VariantRecord;

describe('ordersPlaced', () => {
  it('counts [since, until) without cancelled or deleted orders; total covers all of them', async () => {
    const { db, facade } = setup();
    const since = new Date('2026-11-01T17:00:00Z');
    const until = new Date('2026-11-02T17:00:00Z');
    const first = order('DH1', '2026-11-01T17:00:00Z', { total: 50_000 });
    const last = order('DH2', '2026-11-02T16:59:59Z', { total: 70_000, status: 'delivered' });
    const middle = order('DH3', '2026-11-02T05:00:00Z', { total: 30_000 });
    const atUntil = order('DH4', '2026-11-02T17:00:00Z');
    const cancelled = order('DH5', '2026-11-02T06:00:00Z', { status: 'cancelled' });
    const deleted = order('DH6', '2026-11-02T07:00:00Z');
    db.orders.push(first, last, middle, atUntil, cancelled, deleted);
    db.deletedOrderIds.add(deleted.id);

    const res = await facade.ordersPlaced(ws, { since, until, limit: 2 });
    expect(res.count).toBe(3);
    expect(res.total).toBe(150_000);
    expect(res.items).toEqual([
      {
        id: last.id,
        code: 'DH2',
        total: 70_000,
        status: 'delivered',
        source: 'facebook',
        placedAt: '2026-11-02T16:59:59.000Z',
      },
      expect.objectContaining({ code: 'DH3' }),
    ]);
    // No customer data leaves (S3-R9).
    expect(JSON.stringify(res)).not.toContain('Lan');
  });
});

describe('lowStock', () => {
  it('sums stock over warehouses and lists the lowest first', async () => {
    const { db, facade } = setup();
    const shirt = product('Áo thun');
    const cap = product('Mũ');
    const old = product('Áo cũ', 'archived');
    const red = variant(shirt, 'AT-D', { name: 'Đỏ' });
    const blue = variant(shirt, 'AT-X', { name: 'Xanh' });
    const capV = variant(cap, 'MU-1');
    const gone = variant(cap, 'MU-OLD', { archived: true });
    const oldV = variant(old, 'AC-1');
    const noStock = variant(cap, 'MU-2');
    db.products.push(shirt, cap, old);
    db.variants.push(red, blue, capV, gone, oldV, noStock);
    const [w1, w2] = [newId(), newId()];
    db.stock.push(
      { variantId: red.id, warehouseId: w1, onHand: 3, reserved: 1 },
      { variantId: red.id, warehouseId: w2, onHand: 4, reserved: 0 }, // 6 available
      { variantId: blue.id, warehouseId: w1, onHand: 2, reserved: 0 }, // 2
      { variantId: capV.id, warehouseId: w1, onHand: 5, reserved: 0 }, // 5 (= threshold)
      { variantId: gone.id, warehouseId: w1, onHand: 0, reserved: 0 },
      { variantId: oldV.id, warehouseId: w1, onHand: 0, reserved: 0 },
    );
    const res = await facade.lowStock(ws, { threshold: 5, limit: 20 });
    expect(res).toEqual({
      count: 2,
      items: [
        {
          productId: shirt.id,
          variantId: blue.id,
          name: 'Áo thun - Xanh',
          sku: 'AT-X',
          available: 2,
        },
        { productId: cap.id, variantId: capV.id, name: 'Mũ', sku: 'MU-1', available: 5 },
      ],
    });
    expect((await facade.lowStock(ws, { threshold: 6, limit: 1 })).count).toBe(3);
  });

  it('gives count 0 for a business with no inventory rows', async () => {
    const { db, facade } = setup();
    const p = product('Dịch vụ');
    db.products.push(p);
    db.variants.push(variant(p, 'DV-1'));
    expect(await facade.lowStock(ws, { threshold: 100, limit: 20 })).toEqual({
      count: 0,
      items: [],
    });
  });
});
