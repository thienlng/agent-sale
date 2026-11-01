import { createHmac } from 'node:crypto';

import {
  AuthResponse,
  BootstrapResponse,
  ConnectionDto,
  ContactDto,
  ContactListResponse,
  OrderDto,
  ProductDto,
  ProductListResponse,
  SyncLogResponse,
  WarehouseDto,
} from '@agent-sales/contracts';
import {
  and,
  type Database,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
  withSystem,
  withTenant,
} from '@agent-sales/db';
import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppModule } from '../../../app.module.js';
import { createHttpApp } from '../../../bootstrap.js';
import { DB_SYSTEM, DB_TENANT } from '../../../common/db/db.module.js';
import { INTEGRATION_RUNNER, type IntegrationRunner } from '../api/index.js';
import { type FakeKiotViet, type FakeKvProduct, startFakeKiotViet } from './fake-kiotviet.js';

/**
 * The worker's sync end to end: real Postgres, the real KiotViet client against the fake KiotViet
 * server, the real commerce and crm facades. Full import (2 pages) → stock webhook → reconcile →
 * order push (a lost answer, then the retry adopts the stored order) → order.update cancels it →
 * customers: import (adopting a Rapiz customer by phone), push of a new one, customer.delete.
 */
let pg: TestPostgres;
let kv: FakeKiotViet;
let app: NestFastifyApplication;

const products: FakeKvProduct[] = Array.from({ length: 150 }, (_, i) => ({
  id: 1000 + i,
  code: `KV${1000 + i}`,
  name: `Sản phẩm ${i}`,
  basePrice: 50_000 + i,
  allowsSale: true,
}));
// One master with a colour variant on the far page: the group is fetched and kept whole.
products[149] = {
  ...products[149]!,
  masterProductId: 1000,
  attributes: [{ attributeName: 'Màu', attributeValue: 'Đỏ' }],
};

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  kv = await startFakeKiotViet({
    branches: [
      { id: 1, branchName: 'Trung tâm', address: '1 Lê Lợi' },
      { id: 2, branchName: 'Kho', address: null },
    ],
    products: structuredClone(products),
    onHands: products.map((p) => ({
      productId: p.id,
      inventories: [
        { branchId: 1, onHand: 10, reserved: 3 },
        { branchId: 2, onHand: 100, reserved: 0 },
      ],
    })),
  });
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    S3_ENDPOINT: 'http://127.0.0.1:9',
    S3_BUCKET: 'rapiz-test',
    S3_PUBLIC_URL: 'https://media.rapiz.test',
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
    KIOTVIET_TOKEN_URL: kv.tokenUrl,
    KIOTVIET_API_URL: kv.apiUrl,
    PUBLIC_WEBHOOK_BASE_URL: 'https://hooks.rapiz.test',
    DATABASE_URL: withCredentials(pg.ownerUrl, pg.tenantLogin.user, pg.tenantLogin.password),
    DATABASE_SYSTEM_URL: withCredentials(pg.ownerUrl, pg.systemLogin.user, pg.systemLogin.password),
  });
  app = booted.app;
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await kv?.close();
  await pg?.stop();
});

type Headers = Record<string, string>;
const http = () => app.getHttpAdapter().getInstance();
const call = (h: Headers, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  http().inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });
const runner = () => app.get<IntegrationRunner>(INTEGRATION_RUNNER, { strict: false });

async function owner(): Promise<Headers> {
  const signup = await http().inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    payload: {
      name: 'Chủ shop',
      email: 'kiotviet-sync@shop.vn',
      password: 'a long enough password',
      workspaceName: 'Shop KiotViet',
      industry: 'fashion',
    },
  });
  const { accessToken } = AuthResponse.parse(signup.json());
  const boot = BootstrapResponse.parse(
    (
      await http().inject({
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

/** Ticks the runner until the connection has no open sync job (or gives up). */
async function drain(ws: WorkspaceId, connectionId: string): Promise<void> {
  const db = app.get<Database>(DB_TENANT, { strict: false });
  for (let i = 0; i < 20; i++) {
    await runner().tick();
    const open = await withTenant(db, ws, (tx) =>
      tx
        .select({ id: schema.integrationJobs.id, doneAt: schema.integrationJobs.doneAt })
        .from(schema.integrationJobs)
        .where(eq(schema.integrationJobs.connectionId, connectionId)),
    );
    if (open.every((j) => j.doneAt !== null)) return;
  }
  throw new Error('sync did not finish');
}

describe('KiotViet sync on the worker', () => {
  let h: Headers;
  let ws: WorkspaceId;
  let warehouse: WarehouseDto;
  let connection: ConnectionDto;

  const linkedTotal = async () =>
    ProductListResponse.parse((await call(h, 'GET', '/products?source=kiotviet&pageSize=1')).json())
      .total;
  const productOf = async (externalId: string) => {
    const db = app.get<Database>(DB_TENANT, { strict: false });
    const [row] = await withTenant(db, ws, (tx) =>
      tx
        .select({ id: schema.products.id })
        .from(schema.products)
        .where(eq(schema.products.externalId, externalId)),
    );
    return ProductDto.parse((await call(h, 'GET', `/products/${row!.id}`)).json());
  };
  const onHand = async (externalVariantId: string) => {
    const db = app.get<Database>(DB_TENANT, { strict: false });
    const [row] = await withTenant(db, ws, (tx) =>
      tx
        .select({ onHand: schema.inventory.onHand })
        .from(schema.inventory)
        .innerJoin(
          schema.productVariants,
          eq(schema.productVariants.id, schema.inventory.variantId),
        )
        .where(
          and(
            eq(schema.productVariants.externalId, externalVariantId),
            eq(schema.inventory.warehouseId, warehouse.id),
          ),
        ),
    );
    return row?.onHand;
  };

  beforeAll(async () => {
    h = await owner();
    ws = workspaceId(h['x-workspace-id']!);
    warehouse = WarehouseDto.parse(
      (await call(h, 'POST', '/warehouses', { name: 'Kho chính' })).json(),
    );
  });

  it('imports 150 products in two pages with their stock at the default warehouse', async () => {
    // A Rapiz product the import adopts by SKU, with a variant KiotViet does not have.
    const made = await call(h, 'POST', '/products', {
      code: 'KV1003',
      name: 'Có sẵn trong Rapiz',
      variants: [
        { sku: 'KV1003', price: 1 },
        { sku: 'RAPIZ-ONLY', price: 2 },
      ],
    });
    expect(made.statusCode, made.body).toBe(201);

    const res = await call(h, 'POST', '/integrations/kiotviet', {
      retailer: 'shopdemo',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      settings: { saleBranchIds: [1], orderBranchId: 1, pushOrders: false, syncCustomers: false },
    });
    expect(res.statusCode, res.body).toBe(201);
    connection = ConnectionDto.parse(res.json());
    expect(connection.status).toBe('syncing');

    await drain(ws, connection.id);

    const pages = kv.apiRequests('/products').map((r) => r.query['currentItem']);
    expect(pages).toEqual(['0', '100']);
    expect(
      kv.apiRequests('/products').every((r) => r.query['includeInventory'] === undefined),
    ).toBe(true);
    expect(await linkedTotal()).toBe(149);
    const grouped = await productOf('1000');
    expect(grouped.variants.map((v) => v.sku)).toEqual(['KV1000', 'KV1149']);
    // The adopted product keeps its id; its Rapiz-only variant is archived by the sweep.
    const adopted = await productOf('1003');
    expect(adopted.id).toBe(ProductDto.parse(made.json()).id);
    expect(adopted.variants.map((v) => v.sku)).toEqual(['KV1003']);
    expect(await onHand('1000')).toBe(7);
    expect(await onHand('1149')).toBe(7);

    const after = ConnectionDto.parse(
      (await call(h, 'GET', '/integrations')).json().providers[0].connection,
    );
    expect(after).toMatchObject({ status: 'connected', progress: null, counts: { products: 149 } });
    const log = SyncLogResponse.parse((await call(h, 'GET', '/integrations/kiotviet/log')).json());
    expect(log.entries.find((e) => e.code === 'full_sync_done')?.params).toEqual({
      products: 149,
      images_failed: 0,
    });
  });

  it('applies a signed stock.update delivery', async () => {
    const hook = kv.state.webhooks.find((w) => w.type === 'stock.update');
    expect(hook).toBeDefined();
    const fake = kv.state.products.find((p) => p.id === 1001)!;
    fake['inventories'] = [{ branchId: 1, onHand: 42, reserved: 2 }];

    const body = JSON.stringify({
      Id: 'delivery-1',
      Attempt: 1,
      Notifications: [{ Action: 'stock.update.777', Data: [{ ProductId: 1001, OnHand: 42 }] }],
    });
    const signature = createHmac('sha256', hook!.secret).update(body).digest('hex');
    const system = app.get<Database>(DB_SYSTEM, { strict: false });
    await withSystem(system, (tx) =>
      tx.insert(schema.integrationWebhookEvents).values({
        id: newId(),
        workspaceId: ws,
        connectionId: connection.id,
        deliveryId: 'delivery-1',
        body,
        signature,
      }),
    );
    expect(await onHand('1001')).toBe(7);
    await runner().tick();
    expect(await onHand('1001')).toBe(40);
  });

  it('picks a renamed product up on reconcile', async () => {
    kv.state.products.find((p) => p.id === 1002)!.name = 'Tên mới từ KiotViet';
    const queued = await call(h, 'POST', '/integrations/kiotviet/sync');
    expect(queued.statusCode, queued.body).toBeLessThan(300);
    await drain(ws, connection.id);
    expect((await productOf('1002')).name).toBe('Tên mới từ KiotViet');
    const reconcile = kv.apiRequests('/products').at(-1)!;
    expect(reconcile.query['lastModifiedFrom']).toBeDefined();
  });

  /** Ticks with the clock 20 s ahead, so the 15 s push scan runs on this tick. */
  const scanTick = async () => {
    const realNow = Date.now.bind(Date);
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 20_000);
    try {
      await runner().tick();
    } finally {
      spy.mockRestore();
    }
  };
  const orderOf = async (id: string) =>
    OrderDto.parse((await call(h, 'GET', `/orders/${id}`)).json());
  const setJobsReady = async () => {
    const system = app.get<Database>(DB_SYSTEM, { strict: false });
    await withSystem(system, (tx) =>
      tx
        .update(schema.integrationJobs)
        .set({ runAfter: new Date(Date.now() - 1_000) })
        .where(eq(schema.integrationJobs.connectionId, connection.id)),
    );
  };

  it('pushes a staff order once, even when KiotViet loses its answer, then reads its cancellation', async () => {
    const current = ConnectionDto.parse(
      (await call(h, 'GET', '/integrations')).json().providers[0].connection,
    );
    const patched = await http().inject({
      method: 'PATCH',
      url: '/api/v1/integrations/kiotviet',
      headers: h,
      payload: {
        version: current.version,
        settings: { saleBranchIds: [1], orderBranchId: 1, pushOrders: true, syncCustomers: false },
      },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(kv.state.webhooks.map((w) => w.type)).toContain('order.update');

    const variantId = (await productOf('1001')).variants[0]!.id;
    const created = await call(h, 'POST', '/orders', {
      source: 'hotline',
      warehouseId: warehouse.id,
      customer: { name: 'Lan', phone: '0912345678' },
      recipient: { name: 'Hoa', phone: '0987654321', address: '12 Lý Thường Kiệt' },
      items: [{ variantId, qty: 2 }],
    });
    expect(created.statusCode, created.body).toBe(201);
    const order = OrderDto.parse(created.json());

    // KiotViet stores the order but the answer is lost: the job retries later.
    kv.state.orderCreateFailures = [500];
    await scanTick();
    expect(kv.state.orders).toHaveLength(1);
    expect((await orderOf(order.id)).external).toMatchObject({ state: 'pending' });

    await setJobsReady();
    await runner().tick();
    expect(kv.state.orders).toHaveLength(1);
    expect(kv.apiRequests('/orders').filter((r) => r.method === 'POST')).toHaveLength(1);
    const pushed = await orderOf(order.id);
    expect(pushed).toMatchObject({
      stockState: 'external',
      external: { state: 'pushed', code: kv.state.orders[0]!.code, status: 'draft' },
    });
    // KiotViet reserved the 2 units (42 on hand, 2 + 2 reserved): Rapiz shows that at once, not
    // only after a stock.update delivery or the next reconcile.
    const kvStock = kv.state.products.find((p) => p.id === 1001)!['inventories'] as Array<{
      branchId: number;
      onHand: number;
      reserved: number;
    }>;
    expect(kvStock).toEqual([{ branchId: 1, onHand: 42, reserved: 4 }]);
    expect(await onHand('1001')).toBe(38);
    const kvBody = kv.state.orders[0]!.body as { description: string; branchId: number };
    expect(kvBody.description.startsWith(`Rapiz ${order.code}`)).toBe(true);
    expect(kvBody.branchId).toBe(1);
    const after = ConnectionDto.parse(
      (await call(h, 'GET', '/integrations')).json().providers[0].connection,
    );
    expect(after.counts.ordersPushed).toBe(1);

    // KiotViet cancels it: the signed order.update re-reads the order and cancels the Rapiz one.
    kv.state.orders[0]!.status = 4;
    const hook = kv.state.webhooks.find((w) => w.type === 'order.update')!;
    const body = JSON.stringify({
      Id: 'delivery-2',
      Attempt: 1,
      Notifications: [{ Action: 'order.update.777', Data: [{ Id: kv.state.orders[0]!.id }] }],
    });
    const system = app.get<Database>(DB_SYSTEM, { strict: false });
    await withSystem(system, (tx) =>
      tx.insert(schema.integrationWebhookEvents).values({
        id: newId(),
        workspaceId: ws,
        connectionId: connection.id,
        deliveryId: 'delivery-2',
        body,
        signature: createHmac('sha256', hook.secret).update(body).digest('hex'),
      }),
    );
    await runner().tick();
    expect(await orderOf(order.id)).toMatchObject({
      status: 'cancelled',
      external: { state: 'pushed', status: 'cancelled' },
    });
    const log = SyncLogResponse.parse((await call(h, 'GET', '/integrations/kiotviet/log')).json());
    expect(log.entries.find((e) => e.code === 'order_pushed')?.params).toEqual({
      code: order.code,
    });
  });
  it('syncs customers both ways once the switch is on', async () => {
    const tickAhead = async (ms: number) => {
      const realNow = Date.now.bind(Date);
      const spy = vi.spyOn(Date, 'now').mockImplementation(() => realNow() + ms);
      try {
        await runner().tick();
      } finally {
        spy.mockRestore();
      }
    };
    const contactOf = async (id: string) =>
      ContactDto.parse((await call(h, 'GET', `/contacts/${id}`)).json());
    const made = async (body: object) => {
      const r = await call(h, 'POST', '/contacts', body);
      expect(r.statusCode, r.body).toBe(201);
      return ContactDto.parse(r.json());
    };
    // A Rapiz customer KiotViet also has (same phone), and one only Rapiz has.
    const known = await made({ name: 'Chị A', phone: '0912000001' });
    const fresh = await made({ name: 'Anh B', phone: '0912000002' });
    kv.state.customers = [
      { id: 501, name: 'Chị A (KiotViet)', contactNumber: '0912000001', gender: false },
      { id: 502, name: 'Anh C', contactNumber: '0912000003', address: '9 Hàng Gai' },
    ];

    const current = ConnectionDto.parse(
      (await call(h, 'GET', '/integrations')).json().providers[0].connection,
    );
    const patched = await call(h, 'PATCH', '/integrations/kiotviet', {
      version: current.version,
      settings: { saleBranchIds: [1], orderBranchId: 1, pushOrders: true, syncCustomers: true },
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(kv.state.webhooks.map((w) => w.type)).toEqual(
      expect.arrayContaining(['customer.update', 'customer.delete']),
    );

    await drain(ws, connection.id);
    expect((await contactOf(known.id)).external).toEqual({ source: 'kiotviet', id: '501' });
    const list = ContactListResponse.parse(
      (await call(h, 'POST', '/contacts/query', { pageSize: 100 })).json(),
    );
    const imported = list.data.find((c) => c.external?.id === '502');
    expect(imported).toMatchObject({ name: 'Anh C' });

    // The 30 s scan claims the Rapiz-only customer; its job creates it in KiotViet and links it.
    await tickAhead(60_000);
    await drain(ws, connection.id);
    const posts = kv.apiRequests('/customers').filter((r) => r.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.body).toMatchObject({ name: 'Anh B', contactNumber: '0912000002' });
    const pushedId = String(kv.state.customers.at(-1)!.id);
    expect((await contactOf(fresh.id)).external).toEqual({ source: 'kiotviet', id: pushedId });

    const after = ConnectionDto.parse(
      (await call(h, 'GET', '/integrations')).json().providers[0].connection,
    );
    expect(after.counts.customers).toBe(3);
    const log = SyncLogResponse.parse((await call(h, 'GET', '/integrations/kiotviet/log')).json());
    // 2, or 3 when a push scan linked the Rapiz-only customer before the import finished.
    expect(log.entries.find((e) => e.code === 'customers_synced')?.params).toEqual({
      count: expect.any(Number),
    });

    // KiotViet deletes a customer: the signed delivery unlinks it, the Rapiz customer stays.
    const hook = kv.state.webhooks.find((w) => w.type === 'customer.delete')!;
    const body = JSON.stringify({
      Id: 'delivery-3',
      Attempt: 1,
      Notifications: [{ Action: 'customer.delete.777', Data: [{ RemoveId: [501] }] }],
    });
    const system = app.get<Database>(DB_SYSTEM, { strict: false });
    await withSystem(system, (tx) =>
      tx.insert(schema.integrationWebhookEvents).values({
        id: newId(),
        workspaceId: ws,
        connectionId: connection.id,
        deliveryId: 'delivery-3',
        body,
        signature: createHmac('sha256', hook.secret).update(body).digest('hex'),
      }),
    );
    await runner().tick();
    const unlinked = await contactOf(known.id);
    expect(unlinked.external).toBeNull();
    expect(unlinked.name).toBe('Chị A (KiotViet)');

    // KiotViet no longer has it: the next push scans must not create it there again.
    kv.state.customers = kv.state.customers.filter((c) => c.id !== 501);
    await tickAhead(60_000);
    await drain(ws, connection.id);
    await tickAhead(120_000);
    await drain(ws, connection.id);
    expect(kv.apiRequests('/customers').filter((r) => r.method === 'POST')).toHaveLength(1);
    expect((await contactOf(known.id)).external).toBeNull();
  });
});
