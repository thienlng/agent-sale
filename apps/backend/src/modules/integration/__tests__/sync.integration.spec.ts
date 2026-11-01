import { createHmac } from 'node:crypto';

import {
  AuthResponse,
  BootstrapResponse,
  ConnectionDto,
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
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';
import { createHttpApp } from '../../../bootstrap.js';
import { DB_SYSTEM, DB_TENANT } from '../../../common/db/db.module.js';
import { INTEGRATION_RUNNER, type IntegrationRunner } from '../api/index.js';
import { type FakeKiotViet, type FakeKvProduct, startFakeKiotViet } from './fake-kiotviet.js';

/**
 * The worker's sync end to end: real Postgres, the real KiotViet client against the fake KiotViet
 * server, the real commerce facade. Full import (2 pages) → stock webhook → reconcile.
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
const call = (h: Headers, method: 'GET' | 'POST', url: string, payload?: object) =>
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
});
