import {
  AuthResponse,
  BootstrapResponse,
  OrderDto,
  OrderListResponse,
  OrderOverviewResponse,
  ProductDto,
  VariantSearchResponse,
  WarehouseDto,
} from '@agent-sales/contracts';
import { ensureLoginRoles, migrate, withCredentials } from '@agent-sales/db';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';

/** Products, stock and the order lifecycle on a real Postgres (RLS, SQL search, aggregates). */
let pg: TestPostgres;
let app: NestFastifyApplication;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    DATABASE_SYSTEM_URL: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
  app = booted.app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
});

afterAll(async () => {
  await app?.close();
  await pg?.stop();
});

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
const call = (h: Record<string, string>, method: Method, url: string, payload?: object) =>
  app
    .getHttpAdapter()
    .getInstance()
    .inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });

async function owner(email: string) {
  const inject = app.getHttpAdapter().getInstance().inject.bind(app.getHttpAdapter().getInstance());
  const signup = await inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      name: 'Chủ shop Lan',
      email,
      password: 'a long enough password',
      workspaceName: 'Shop Lan',
      industry: 'fashion',
    },
  });
  const { accessToken } = AuthResponse.parse(signup.json());
  const boot = BootstrapResponse.parse(
    (
      await inject({
        method: 'GET',
        url: '/api/v1/bootstrap',
        headers: { authorization: `Bearer ${accessToken}` },
      })
    ).json(),
  );
  return {
    authorization: `Bearer ${accessToken}`,
    'x-workspace-id': boot.memberships[0]?.workspaceId ?? '',
  };
}

async function setup(h: Record<string, string>) {
  const warehouse = WarehouseDto.parse(
    (await call(h, 'POST', '/warehouses', { name: 'Kho Quận 1' })).json(),
  );
  const productRes = await call(h, 'POST', '/products', {
    code: 'AT01',
    name: 'Áo thun trơn',
    variants: [
      { sku: 'AT01-L', name: 'Trắng / L', price: 150_000, cost: 90_000 },
      { sku: 'AT01-M', name: 'Trắng / M', price: 140_000, cost: 85_000 },
    ],
  });
  expect(productRes.statusCode).toBe(201);
  const product = ProductDto.parse(productRes.json());
  const [l, m] = product.variants;
  for (const variant of [l, m]) {
    const r = await call(h, 'POST', `/products/${product.id}/stock`, {
      variantId: variant!.id,
      warehouseId: warehouse.id,
      onHand: 10,
    });
    expect(r.statusCode).toBe(200);
  }
  return { warehouse, product, l: l!, m: m! };
}

const orderBody = (warehouseId: string, items: Array<{ variantId: string; qty: number }>) => ({
  source: 'facebook',
  warehouseId,
  customer: { name: 'Trần Văn Bình', phone: '0901234567' },
  recipient: { name: 'Trần Văn Bình', phone: '0901234567', address: '12 Lê Lợi, Phường Bến Nghé' },
  items,
  shippingFee: 30_000,
  shippingFeeCharged: 30_000,
  transferAmount: 100_000,
  noteInternal: 'Khách quen, giao giờ hành chính',
});

const stockOf = async (h: Record<string, string>, productId: string, variantId: string) => {
  const p = ProductDto.parse((await call(h, 'GET', `/products/${productId}`)).json());
  return p.variants.find((x) => x.id === variantId)?.stock[0];
};

describe('commerce on Postgres', () => {
  it('persists product-specific bot guidance and visibility without copying the catalog', async () => {
    const headers = await owner('training-catalog@example.test');
    const response = await call(headers, 'POST', '/products', {
      code: 'TRAINING-1',
      name: 'Training product',
      botInstructions: 'Ask about the preferred size.',
      visibleToBot: false,
      variants: [{ sku: 'TRAINING-SKU', price: 120000 }],
    });
    expect(response.statusCode).toBe(201);
    const product = ProductDto.parse(response.json());
    expect(product).toMatchObject({
      botInstructions: 'Ask about the preferred size.',
      visibleToBot: false,
    });
    const read = ProductDto.parse((await call(headers, 'GET', `/products/${product.id}`)).json());
    expect(read.botInstructions).toBe(product.botInstructions);
    const updated = await call(headers, 'PUT', `/products/${product.id}`, {
      code: product.code,
      name: product.name,
      botInstructions: 'Explain the warranty.',
      visibleToBot: true,
      variants: product.variants.map((variant) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        price: variant.price,
        cost: variant.cost,
        weightGram: variant.weightGram,
      })),
    });
    expect(updated.statusCode).toBe(200);
    expect(ProductDto.parse(updated.json())).toMatchObject({
      botInstructions: 'Explain the warranty.',
      visibleToBot: true,
    });
  });

  it('runs an order through reservation, shipping, a refused cancel and a return', async () => {
    const h = await owner('lifecycle@shop.vn');
    const { warehouse, product, l } = await setup(h);
    expect(warehouse.isDefault).toBe(true);

    const created = await call(
      h,
      'POST',
      '/orders',
      orderBody(warehouse.id, [{ variantId: l.id, qty: 3 }]),
    );
    expect(created.statusCode).toBe(201);
    const order = OrderDto.parse(created.json());
    expect(order.code).toBe('DH000001');
    expect(order.amounts).toMatchObject({
      subtotal: 450_000,
      total: 480_000,
      paid: 100_000,
      remaining: 380_000,
      cod: 380_000,
    });
    expect(order.createdByName).toBe('Chủ shop Lan');
    expect(await stockOf(h, product.id, l.id)).toMatchObject({
      onHand: 10,
      reserved: 3,
      available: 7,
    });

    const shipped = await call(h, 'POST', `/orders/${order.id}/status`, { status: 'delivering' });
    expect(OrderDto.parse(shipped.json()).stockState).toBe('shipped');
    expect(await stockOf(h, product.id, l.id)).toMatchObject({ onHand: 7, reserved: 0 });

    const cancel = await call(h, 'POST', `/orders/${order.id}/status`, { status: 'cancelled' });
    expect(cancel.statusCode).toBe(409);

    const returned = OrderDto.parse(
      (
        await call(h, 'POST', `/orders/${order.id}/status`, {
          status: 'returned',
          note: 'Khách không nhận',
        })
      ).json(),
    );
    expect(returned.history.map((x) => x.toStatus)).toEqual(['new', 'delivering', 'returned']);
    expect(returned.history.at(-1)?.note).toBe('Khách không nhận');
    expect(await stockOf(h, product.id, l.id)).toMatchObject({ onHand: 10, reserved: 0 });

    const second = OrderDto.parse(
      (
        await call(h, 'POST', '/orders', orderBody(warehouse.id, [{ variantId: l.id, qty: 1 }]))
      ).json(),
    );
    expect(second.code).toBe('DH000002');
    await call(h, 'POST', `/orders/${second.id}/status`, { status: 'cancelled' });
    expect(await stockOf(h, product.id, l.id)).toMatchObject({ onHand: 10, reserved: 0 });
  });

  it('lists with status counts, accent-insensitive search and totals; the overview agrees', async () => {
    const h = await owner('list@shop.vn');
    const { warehouse, l, m } = await setup(h);
    const a = OrderDto.parse(
      (
        await call(h, 'POST', '/orders', orderBody(warehouse.id, [{ variantId: l.id, qty: 2 }]))
      ).json(),
    );
    await call(h, 'POST', '/orders', {
      ...orderBody(warehouse.id, [{ variantId: m.id, qty: 1 }]),
      customer: { name: 'Lê Thị Hoa', phone: '0912345678' },
      recipient: { name: 'Lê Thị Hoa', phone: '0912345678', address: 'Hà Nội' },
      freeShipping: true,
    });
    await call(h, 'POST', `/orders/${a.id}/status`, { status: 'confirmed' });

    const all = OrderListResponse.parse((await call(h, 'GET', '/orders')).json());
    expect(all.total).toBe(2);
    expect(all.counts).toMatchObject({ all: 2, new: 1, confirmed: 1 });
    expect(all.totals.itemQty).toBe(3);

    const search = OrderListResponse.parse(
      (await call(h, 'GET', '/orders?q=le%20thi%20hoa')).json(),
    );
    expect(search.data.map((o) => o.customer.name)).toEqual(['Lê Thị Hoa']);
    const byNote = OrderListResponse.parse((await call(h, 'GET', '/orders?q=khach%20quen')).json());
    expect(byNote.total).toBe(2);
    const confirmed = OrderListResponse.parse(
      (await call(h, 'GET', '/orders?status=confirmed')).json(),
    );
    expect(confirmed.data.map((o) => o.id)).toEqual([a.id]);

    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(
      new Date(),
    );
    const overview = OrderOverviewResponse.parse(
      (await call(h, 'GET', `/orders/overview?from=${today}&to=${today}`)).json(),
    );
    // Closed = only the confirmed order: 2 × 150k + 30k shipping charged.
    expect(overview.kpis).toMatchObject({ closedOrders: 1, revenue: 330_000, productQty: 2 });
    expect(overview.kpis.sales).toBe(330_000 + 140_000);
    // Profit = 300k − 180k cost − 0 discount − (30k − 30k).
    expect(overview.kpis.profit).toBe(120_000);
    expect(overview.today).toMatchObject({ created: 2, closedOrders: 1 });
    expect(overview.series).toHaveLength(1);
  });

  it('keeps catalogs and orders of different shops apart, and rejects duplicate SKUs', async () => {
    const h1 = await owner('a@shop.vn');
    const h2 = await owner('b@shop.vn');
    const { product } = await setup(h1);
    expect((await call(h2, 'GET', `/products/${product.id}`)).statusCode).toBe(404);
    const list2 = (await call(h2, 'GET', '/products')).json() as { total: number };
    expect(list2.total).toBe(0);

    const dup = await call(h1, 'POST', '/products', {
      code: 'AT02',
      name: 'Áo khác',
      variants: [{ sku: 'at01-l', name: '', price: 1 }],
    });
    expect(dup.statusCode).toBe(409);

    const w1 = (await call(h1, 'GET', '/warehouses')).json() as { data: Array<{ id: string }> };
    const picker = VariantSearchResponse.parse(
      (
        await call(
          h1,
          'GET',
          `/product-variants?warehouseId=${w1.data[0]?.id}&q=ao%20thun&inStock=true`,
        )
      ).json(),
    );
    expect(picker.data.map((x) => x.sku).sort()).toEqual(['AT01-L', 'AT01-M']);
  });

  it('enforces order settings: optional statuses and required notes', async () => {
    const h = await owner('settings@shop.vn');
    const { warehouse, l } = await setup(h);
    const o = OrderDto.parse(
      (
        await call(h, 'POST', '/orders', orderBody(warehouse.id, [{ variantId: l.id, qty: 1 }]))
      ).json(),
    );
    const put = await call(h, 'PUT', '/order-settings', {
      extraStatuses: [],
      requireNoteStatuses: ['cancelled'],
    });
    expect(put.statusCode).toBe(200);
    expect(
      (await call(h, 'POST', `/orders/${o.id}/status`, { status: 'printed' })).statusCode,
    ).toBe(400);
    expect(
      (await call(h, 'POST', `/orders/${o.id}/status`, { status: 'cancelled' })).statusCode,
    ).toBe(400);
    const ok = await call(h, 'POST', `/orders/${o.id}/status`, {
      status: 'cancelled',
      note: 'Khách đổi ý',
    });
    expect(ok.statusCode).toBe(200);
  });

  it('serialises concurrent status changes: stock moves exactly once', async () => {
    const h = await owner('race@shop.vn');
    const { warehouse, product, l } = await setup(h);
    const o = OrderDto.parse(
      (
        await call(h, 'POST', '/orders', orderBody(warehouse.id, [{ variantId: l.id, qty: 2 }]))
      ).json(),
    );
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        call(h, 'POST', `/orders/${o.id}/status`, { status: 'delivering' }),
      ),
    );
    expect(results.every((r) => r.statusCode === 200)).toBe(true);
    expect(await stockOf(h, product.id, l.id)).toMatchObject({ onHand: 8, reserved: 0 });
    const detail = OrderDto.parse((await call(h, 'GET', `/orders/${o.id}`)).json());
    expect(detail.history.map((x) => x.toStatus)).toEqual(['new', 'delivering']);
  });

  it('creates one order per draft, even when it is submitted twice at once', async () => {
    const h = await owner('idem@shop.vn');
    const { warehouse, product, l } = await setup(h);
    const body = {
      ...orderBody(warehouse.id, [{ variantId: l.id, qty: 1 }]),
      clientRequestId: crypto.randomUUID(),
    };
    const [a, b] = await Promise.all([
      call(h, 'POST', '/orders', body),
      call(h, 'POST', '/orders', body),
    ]);
    const again = await call(h, 'POST', '/orders', body);
    const ids = [a, b, again].map((r) => (r.json() as { id: string }).id);
    expect(new Set(ids).size).toBe(1);
    const list = OrderListResponse.parse((await call(h, 'GET', '/orders')).json());
    expect(list.total).toBe(1);
    expect(await stockOf(h, product.id, l.id)).toMatchObject({ reserved: 1 });
  });

  it('treats % and _ in searches literally, refuses archived products and over-long ranges', async () => {
    const h = await owner('edge@shop.vn');
    const { warehouse, product, l } = await setup(h);
    await call(h, 'POST', '/orders', orderBody(warehouse.id, [{ variantId: l.id, qty: 1 }]));
    expect(OrderListResponse.parse((await call(h, 'GET', '/orders?q=%25')).json()).total).toBe(0);
    expect(OrderListResponse.parse((await call(h, 'GET', '/orders?q=_')).json()).total).toBe(0);

    const archived = await call(h, 'PUT', `/products/${product.id}`, {
      code: product.code,
      name: product.name,
      status: 'archived',
      variants: product.variants.map((v) => ({
        id: v.id,
        sku: v.sku,
        name: v.name,
        price: v.price,
        cost: v.cost,
      })),
    });
    expect(archived.statusCode).toBe(200);
    const refused = await call(
      h,
      'POST',
      '/orders',
      orderBody(warehouse.id, [{ variantId: l.id, qty: 1 }]),
    );
    expect(refused.statusCode).toBe(400);

    expect(
      (await call(h, 'GET', '/orders/overview?from=2024-01-01&to=2026-01-01')).statusCode,
    ).toBe(400);
  });
});
