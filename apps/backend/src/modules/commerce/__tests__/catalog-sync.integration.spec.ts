import {
  AuthResponse,
  BootstrapResponse,
  ProductDto,
  ProductListResponse,
  WarehouseDto,
} from '@agent-sales/contracts';
import {
  type Database,
  ensureLoginRoles,
  eq,
  migrate,
  schema,
  withCredentials,
  withTenant,
} from '@agent-sales/db';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';
import { createHttpApp } from '../../../bootstrap.js';
import { DB_TENANT } from '../../../common/db/db.module.js';
import {
  CATALOG_SYNC_FACADE,
  type CatalogSyncFacade,
  type ExternalCatalogItem,
} from '../api/index.js';

/** The PMS sync's writes on a real Postgres: links, adoption by SKU, stock movements, locks. */
const MEDIA_URL = 'https://media.rapiz.test';
let pg: TestPostgres;
let app: NestFastifyApplication;

beforeAll(async () => {
  pg = await startTestPostgres();
  await migrate(pg.ownerUrl);
  await ensureLoginRoles(pg.ownerUrl, { tenant: pg.tenantLogin, system: pg.systemLogin });
  const booted = await createHttpApp(AppModule, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'error',
    S3_ENDPOINT: 'http://127.0.0.1:9',
    S3_BUCKET: 'rapiz-test',
    S3_PUBLIC_URL: MEDIA_URL,
    S3_ACCESS_KEY: 'test',
    S3_SECRET_KEY: 'test',
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

type Headers = Record<string, string>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
const http = () => app.getHttpAdapter().getInstance();
const call = (h: Headers, method: Method, url: string, payload?: object) =>
  http().inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });
const sync = () => app.get<CatalogSyncFacade>(CATALOG_SYNC_FACADE, { strict: false });

let signups = 0;
async function owner(email: string): Promise<Headers> {
  const signup = await http().inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    remoteAddress: `10.3.0.${++signups}`,
    payload: {
      name: 'Chủ shop',
      email,
      password: 'a long enough password',
      workspaceName: 'Shop áo',
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

const item = (patch: Partial<ExternalCatalogItem> = {}): ExternalCatalogItem => ({
  externalId: '1001',
  name: 'Áo thun cổ tròn',
  description: 'Cotton 100%',
  category: 'Áo',
  active: true,
  imageUrls: [],
  variants: [
    { externalId: '2001', sku: 'AT-S', name: 'S', price: 150_000, weightGram: 200, position: 0 },
    { externalId: '2002', sku: 'AT-M', name: 'M', price: 160_000, weightGram: 210, position: 1 },
  ],
  ...patch,
});

/** The body of PUT /products/{id} that keeps every field of the product as it is. */
function sameBody(p: ProductDto) {
  return {
    code: p.code,
    name: p.name,
    description: p.description,
    category: p.category,
    visibleToBot: p.visibleToBot,
    botInstructions: p.botInstructions,
    imageUrls: p.imageUrls,
    status: p.status,
    variants: p.variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      name: v.name,
      price: v.price,
      cost: v.cost,
      weightGram: v.weightGram,
    })),
  };
}

describe('catalog sync facade on Postgres', () => {
  let h: Headers;
  let ws: WorkspaceId;
  let warehouse: WarehouseDto;
  let productId: string;

  const get = async (id: string) =>
    ProductDto.parse((await call(h, 'GET', `/products/${id}`)).json());
  const movements = (db: Database) =>
    withTenant(db, ws, (tx) =>
      tx
        .select()
        .from(schema.inventoryMovements)
        .where(eq(schema.inventoryMovements.refType, 'external')),
    );

  beforeAll(async () => {
    h = await owner('catalog-sync@shop.vn');
    ws = workspaceId(h['x-workspace-id']!);
    warehouse = WarehouseDto.parse(
      (await call(h, 'POST', '/warehouses', { name: 'Kho chính' })).json(),
    );
  });

  it('creates a linked product with stock rows at the default warehouse', async () => {
    const res = await sync().upsertExternalProduct(ws, 'kiotviet', item());
    expect(res).toMatchObject({ created: true, applied: true, skipped: [] });
    productId = String(res.productId);
    const p = await get(productId);
    expect(p).toMatchObject({
      code: 'AT-S',
      name: 'Áo thun cổ tròn',
      category: 'Áo',
      status: 'active',
      external: { source: 'kiotviet', id: '1001' },
    });
    expect(p.variants.map((v) => [v.sku, v.price, v.stock[0]?.onHand])).toEqual([
      ['AT-S', 150_000, 0],
      ['AT-M', 160_000, 0],
    ]);
    expect(p.variants[0]?.stock[0]?.warehouseId).toBe(warehouse.id);
    expect(await sync().countExternalProducts(ws, 'kiotviet')).toBe(1);
  });

  it('keeps Rapiz-owned fields editable and refuses linked ones with 409 EXTERNAL_SOURCE', async () => {
    const p = await get(productId);
    const toggled = await call(h, 'PUT', `/products/${productId}`, {
      ...sameBody(p),
      visibleToBot: false,
      botInstructions: 'Chỉ bán size S, M',
    });
    expect(toggled.statusCode).toBe(200);
    expect(ProductDto.parse(toggled.json()).external).toEqual({ source: 'kiotviet', id: '1001' });

    const refused = async (body: object, field: string) => {
      const res = await call(h, 'PUT', `/products/${productId}`, body);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toMatchObject({
        code: 'CONFLICT',
        details: { reason: 'EXTERNAL_SOURCE', field },
      });
    };
    await refused({ ...sameBody(p), name: 'Áo mới' }, 'name');
    await refused({ ...sameBody(p), status: 'archived' }, 'status');
    const priced = sameBody(p);
    priced.variants[0]!.price = 1;
    await refused(priced, 'variants');

    const stock = await call(h, 'POST', `/products/${productId}/stock`, {
      variantId: p.variants[0]!.id,
      warehouseId: warehouse.id,
      onHand: 9,
    });
    expect(stock.statusCode).toBe(409);
    expect(stock.json().error.details).toEqual({ reason: 'EXTERNAL_SOURCE', field: 'stock' });
  });

  it('updates linked fields on the next upsert, archives a removed variant, keeps bot fields', async () => {
    const before = await get(productId);
    const res = await sync().upsertExternalProduct(
      ws,
      'kiotviet',
      item({
        name: 'Áo thun cổ tròn 2026',
        variants: [
          {
            externalId: '2001',
            sku: 'AT-S',
            name: 'S',
            price: 155_000,
            weightGram: 200,
            position: 0,
          },
        ],
      }),
    );
    expect(res).toEqual({ productId, created: false, applied: true, skipped: [] });
    const p = await get(productId);
    expect(p.name).toBe('Áo thun cổ tròn 2026');
    expect(p.visibleToBot).toBe(false);
    expect(p.botInstructions).toBe('Chỉ bán size S, M');
    expect(p.variants.map((v) => [v.id, v.price])).toEqual([[before.variants[0]!.id, 155_000]]);
  });

  it('adopts a Rapiz product by SKU and skips SKUs another product already uses', async () => {
    const created = await call(h, 'POST', '/products', {
      code: 'QJ',
      name: 'Quần jean',
      botInstructions: 'Hỏi chiều cao',
      variants: [{ sku: 'QJ-30', price: 300_000, cost: 120_000 }],
    });
    expect(created.statusCode).toBe(201);
    const rapiz = ProductDto.parse(created.json());

    const adopted = await sync().upsertExternalProduct(
      ws,
      'kiotviet',
      item({
        externalId: '1002',
        name: 'Quần jean xanh',
        variants: [
          {
            externalId: '2010',
            sku: 'qj-30',
            name: '30',
            price: 320_000,
            weightGram: 500,
            position: 0,
          },
        ],
      }),
    );
    expect(adopted).toEqual({ productId: rapiz.id, created: false, applied: true, skipped: [] });
    const p = await get(rapiz.id);
    expect(p).toMatchObject({
      code: 'QJ',
      name: 'Quần jean xanh',
      botInstructions: 'Hỏi chiều cao',
      external: { source: 'kiotviet', id: '1002' },
    });
    expect(p.variants.map((v) => [v.id, v.sku, v.price, v.cost])).toEqual([
      [rapiz.variants[0]!.id, 'qj-30', 320_000, 120_000],
    ]);

    // A second store product reusing a live SKU of another product: that variant is skipped.
    const clash = await sync().upsertExternalProduct(
      ws,
      'kiotviet',
      item({
        externalId: '1003',
        name: 'Quần short',
        variants: [
          { externalId: '2020', sku: 'QJ-30', name: '', price: 1, weightGram: 0, position: 0 },
          { externalId: '2021', sku: 'QS-1', name: '', price: 2, weightGram: 0, position: 1 },
        ],
      }),
    );
    expect(clash).toMatchObject({ created: true, skipped: ['QJ-30'] });
    expect((await get(String(clash.productId))).variants.map((v) => v.sku)).toEqual(['QS-1']);
  });

  it('writes nothing when no input variant can be kept', async () => {
    const before = await get(productId);
    // A new store product whose only SKU is another product's: no product is created.
    const none = await sync().upsertExternalProduct(
      ws,
      'kiotviet',
      item({
        externalId: '1004',
        variants: [
          { externalId: '2030', sku: 'QS-1', name: '', price: 1, weightGram: 0, position: 0 },
        ],
      }),
    );
    expect(none).toEqual({ productId: null, created: false, applied: false, skipped: ['QS-1'] });
    // A linked product whose item has no variant, or only clashing ones, stays as it was.
    for (const variants of [
      [],
      [{ externalId: '2001', sku: 'QS-1', name: 'S', price: 1, weightGram: 0, position: 0 }],
    ]) {
      const res = await sync().upsertExternalProduct(
        ws,
        'kiotviet',
        item({ name: 'Đổi tên', variants }),
      );
      expect(res).toMatchObject({ productId, created: false, applied: false });
    }
    const after = await get(productId);
    expect(after).toMatchObject({ name: before.name, status: 'active' });
    expect(after.variants.map((v) => v.id)).toEqual(before.variants.map((v) => v.id));
    expect(await sync().countExternalProducts(ws, 'kiotviet')).toBe(3);
  });

  it('sets stock through one movement per change and is idempotent', async () => {
    const db = app.get<Database>(DB_TENANT, { strict: false });
    const rows = [
      { externalVariantId: '2001', available: 7 },
      { externalVariantId: 'unknown', available: 3 },
    ];
    expect(await sync().setExternalStock(ws, 'kiotviet', rows)).toBe(1);
    expect(await sync().setExternalStock(ws, 'kiotviet', rows)).toBe(0);
    const moved = await movements(db);
    expect(moved.map((m) => [m.onHandDelta, m.reason, m.actorUserId])).toEqual([
      [7, 'adjust', null],
    ]);
    const p = await get(productId);
    expect(p.variants[0]?.stock[0]).toMatchObject({ warehouseId: warehouse.id, onHand: 7 });
  });

  it('filters the product list by source', async () => {
    const list = async (source: string) =>
      ProductListResponse.parse((await call(h, 'GET', `/products?source=${source}`)).json());
    const kv = await list('kiotviet');
    expect(kv.data.every((p) => p.external?.source === 'kiotviet')).toBe(true);
    expect(kv.total).toBe(3);
    await call(h, 'POST', '/products', {
      code: 'MU',
      name: 'Mũ',
      variants: [{ sku: 'MU-1', price: 50_000 }],
    });
    const rapiz = await list('rapiz');
    expect(rapiz.data.map((p) => p.code)).toEqual(['MU']);
  });

  it('previews how the store codes match the catalog', async () => {
    expect(await sync().previewExternalMatch(ws, ['mu-1', 'NEW-1', 'NEW-1', 'AT-S'])).toEqual({
      matched: 2,
      created: 1,
      rapizOnly: 0,
    });
    expect(await sync().previewExternalMatch(ws, ['NEW-1'])).toMatchObject({ rapizOnly: 1 });
  });

  it('cuts long PMS text to the form limits and keeps bot fields editable', async () => {
    const res = await sync().upsertExternalProduct(
      ws,
      'kiotviet',
      item({
        externalId: '1005',
        name: `  ${'N'.repeat(250)}`,
        description: 'd'.repeat(6000),
        category: 'c'.repeat(130),
        variants: [
          {
            externalId: '2050',
            sku: 'KV 05',
            name: 'v'.repeat(130),
            price: 1,
            weightGram: 0,
            position: 0,
          },
        ],
      }),
    );
    const id = String(res.productId);
    const p = await get(id);
    expect([p.name.length, p.description.length, p.category?.length]).toEqual([200, 5000, 120]);
    expect(p.variants.map((v) => [v.sku, v.name.length])).toEqual([['KV 05', 120]]);
    // The code keeps the store's space, so the full form refuses it; the bot fields still save.
    expect(p.code).toBe('KV 05');
    expect((await call(h, 'PUT', `/products/${id}`, sameBody(p))).statusCode).toBe(400);
    const patched = await call(h, 'PATCH', `/products/${id}/bot-settings`, {
      visibleToBot: false,
      botInstructions: 'Chỉ tư vấn, không chốt đơn',
    });
    expect(patched.statusCode).toBe(200);
    expect(ProductDto.parse(patched.json())).toMatchObject({
      visibleToBot: false,
      botInstructions: 'Chỉ tư vấn, không chốt đơn',
      external: { source: 'kiotviet', id: '1005' },
    });
    const half = await call(h, 'PATCH', `/products/${id}/bot-settings`, { visibleToBot: true });
    expect(ProductDto.parse(half.json())).toMatchObject({
      visibleToBot: true,
      botInstructions: 'Chỉ tư vấn, không chốt đơn',
    });
    expect((await call(h, 'PATCH', `/products/${id}/bot-settings`, {})).statusCode).toBe(400);
  });

  it('serializes concurrent upserts of one store product into one product', async () => {
    const same = item({
      externalId: '1006',
      variants: [
        { externalId: '2060', sku: 'CC-1', name: '', price: 1, weightGram: 0, position: 0 },
      ],
    });
    const results = await Promise.all([
      sync().upsertExternalProduct(ws, 'kiotviet', same),
      sync().upsertExternalProduct(ws, 'kiotviet', same),
    ]);
    expect(new Set(results.map((r) => r.productId)).size).toBe(1);
    expect(results.map((r) => r.created).sort()).toEqual([false, true]);
    expect(await sync().countExternalProducts(ws, 'kiotviet')).toBe(5);
  });

  it('keeps unnamed variants on a partial upsert and removes variants by external id', async () => {
    const v = (externalId: string, sku: string, position: number) => ({
      externalId,
      sku,
      name: sku,
      price: 100_000,
      weightGram: 0,
      position,
    });
    const group = item({
      externalId: '1100',
      name: 'Váy',
      variants: [v('1100', 'VAY-1', 0), v('1101', 'VAY-2', 1), v('1102', 'VAY-3', 2)],
    });
    const first = await sync().upsertExternalProduct(ws, 'kiotviet', group, { partial: true });
    const id = String(first.productId);

    // A webhook for one child carries the master and that child only: the sibling stays live.
    const part = await sync().upsertExternalProduct(
      ws,
      'kiotviet',
      item({
        externalId: '1100',
        name: 'Váy mới',
        variants: [{ ...v('1100', 'VAY-1', 0) }, { ...v('1102', 'VAY-3', 1), price: 120_000 }],
      }),
      { partial: true },
    );
    expect(part).toMatchObject({ productId: id, applied: true });
    let p = await get(id);
    expect(p.name).toBe('Váy mới');
    expect(p.variants.map((x) => [x.sku, x.price])).toEqual([
      ['VAY-1', 100_000],
      ['VAY-2', 100_000],
      ['VAY-3', 120_000],
    ]);
    // A new child arrives after the known ones.
    await sync().upsertExternalProduct(
      ws,
      'kiotviet',
      item({ externalId: '1100', name: 'Váy mới', variants: [v('1103', 'VAY-4', 1)] }),
      { partial: true },
    );
    p = await get(id);
    expect(p.variants.map((x) => x.sku)).toEqual(['VAY-1', 'VAY-2', 'VAY-3', 'VAY-4']);

    const linked = await sync().linkedExternalIds(ws, 'kiotviet');
    expect(linked.products).toContain('1100');
    expect(linked.variants).toEqual(expect.arrayContaining(['1100', '1101', '1102', '1103']));

    // A deleted child archives that variant only; the product stays.
    expect(await sync().removeExternalProducts(ws, 'kiotviet', ['1101'])).toBe(1);
    p = await get(id);
    expect(p.status).toBe('active');
    expect(p.variants.map((x) => x.sku)).toEqual(['VAY-1', 'VAY-3', 'VAY-4']);
    expect((await sync().linkedExternalIds(ws, 'kiotviet')).variants).not.toContain('1101');

    // Deleting the master archives the product (and its master variant).
    await sync().removeExternalProducts(ws, 'kiotviet', ['1100']);
    expect((await get(id)).status).toBe('archived');
    expect((await sync().linkedExternalIds(ws, 'kiotviet')).products).not.toContain('1100');
  });

  it('archives removed products and releases the links on disconnect', async () => {
    expect(await sync().removeExternalProducts(ws, 'kiotviet', ['1003', 'missing'])).toBe(1);
    const p = await get(productId);
    const released = await sync().releaseExternalSource(ws, 'kiotviet');
    expect(released).toBe(6);
    expect(await sync().countExternalProducts(ws, 'kiotviet')).toBe(0);
    const res = await call(h, 'PUT', `/products/${productId}`, { ...sameBody(p), name: 'Áo mới' });
    expect(res.statusCode).toBe(200);
    expect(ProductDto.parse(res.json())).toMatchObject({ name: 'Áo mới', external: null });
    const db = app.get<Database>(DB_TENANT, { strict: false });
    const linked = await withTenant(db, ws, (tx) =>
      tx
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(eq(schema.productVariants.externalId, '2001')),
    );
    expect(linked).toEqual([]);
  });
});
