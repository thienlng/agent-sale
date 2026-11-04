import {
  AuthResponse,
  BootstrapResponse,
  BotDto,
  ProductDto,
  PRODUCT_SUMMARY_PAGE_MAX,
  ProductListResponse,
  ProductSummaryListResponse,
  WarehouseDto,
} from '@agent-sales/contracts';
import { ensureLoginRoles, migrate, withCredentials } from '@agent-sales/db';
import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { createHttpApp } from '../src/bootstrap.js';
import {
  CATALOG_SYNC_FACADE,
  type CatalogSyncFacade,
  COMMERCE_FACADE,
  type CommerceFacade,
} from '../src/modules/commerce/api/index.js';
import { signUpVerified } from './support/signup.js';

/** Courses and services stored on products (`offering`, T-187) on a real Postgres. */
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
    S3_PUBLIC_URL: 'https://media.rapiz.test',
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
type Method = 'GET' | 'POST' | 'PUT';
const http = () => app.getHttpAdapter().getInstance();
const call = (h: Headers, method: Method, url: string, payload?: object) =>
  http().inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });
const commerce = () => app.get<CommerceFacade>(COMMERCE_FACADE, { strict: false });
const sync = () => app.get<CatalogSyncFacade>(CATALOG_SYNC_FACADE, { strict: false });

async function owner(email: string, remoteAddress: string): Promise<Headers> {
  const signup = await signUpVerified(
    app,
    {
      name: 'Chủ spa',
      email,
      password: 'a long enough password',
      workspaceName: 'Spa Hoa',
      industry: 'fashion',
    },
    { remoteAddress },
  );
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

const facial = {
  kind: 'service',
  durationMinutes: 60,
  sessions: 10,
  format: 'offline',
  schedule: 'Hằng ngày 9h–21h',
  outcomes: ['Da sáng hơn'],
  priceNote: 'giá tham khảo',
};

/** The body of PUT /products/{id} that keeps every field; `offering` is left out. */
const sameBody = (p: ProductDto) => ({
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
});

describe('product offerings on Postgres', () => {
  let h: Headers;
  let ws: WorkspaceId;
  let warehouse: WarehouseDto;

  const get = async (id: string) =>
    ProductDto.parse((await call(h, 'GET', `/products/${id}`)).json());

  beforeAll(async () => {
    h = await owner('offering@spa.vn', '10.7.0.1');
    ws = workspaceId(h['x-workspace-id']!);
    warehouse = WarehouseDto.parse(
      (await call(h, 'POST', '/warehouses', { name: 'Kho chính' })).json(),
    );
  });

  it('creates and reads a product with an offering, with the defaults filled in', async () => {
    const res = await call(h, 'POST', '/products', {
      code: 'CS-MAT',
      name: 'Chăm sóc da mặt',
      variants: [{ sku: 'CS-MAT-1', price: 0 }],
      offering: facial,
    });
    expect(res.statusCode).toBe(201);
    const created = ProductDto.parse(res.json());
    const expected = {
      ...facial,
      period: '',
      level: '',
      audience: '',
    };
    expect(created.offering).toEqual(expected);
    expect((await get(created.id)).offering).toEqual(expected);
  });

  it('keeps the offering when an update omits it, and clears it on null', async () => {
    const created = ProductDto.parse(
      (
        await call(h, 'POST', '/products', {
          code: 'KH-IELTS',
          name: 'IELTS 6.5',
          variants: [{ sku: 'KH-IELTS-1', price: 9_000_000 }],
          offering: { kind: 'course', sessions: 36, period: '3 tháng', level: 'B1' },
        })
      ).json(),
    );
    const kept = await call(h, 'PUT', `/products/${created.id}`, {
      ...sameBody(created),
      name: 'IELTS 6.5+',
    });
    expect(kept.statusCode).toBe(200);
    expect(ProductDto.parse(kept.json()).offering).toMatchObject({
      kind: 'course',
      sessions: 36,
      period: '3 tháng',
    });

    const cleared = await call(h, 'PUT', `/products/${created.id}`, {
      ...sameBody(created),
      offering: null,
    });
    expect(cleared.statusCode).toBe(200);
    expect(ProductDto.parse(cleared.json()).offering).toBeNull();
    expect((await get(created.id)).offering).toBeNull();
  });

  it('refuses an offering together with an accommodation', async () => {
    const res = await call(h, 'POST', '/products', {
      code: 'VILLA',
      name: 'Villa biển',
      variants: [{ sku: 'VILLA-1', price: 3_000_000 }],
      offering: facial,
      accommodation: {
        rentalType: 'entire_property',
        bedrooms: 2,
        standardAdults: 4,
        standardChildren: 0,
        childAgeBelow: 6,
        maxGuests: 6,
        roomLayout: [{ name: 'Phòng 1', beds: '1 giường đôi' }],
        amenities: [],
        rateBasis: 'unconfirmed',
        rates: [{ days: [1, 2, 3, 4, 5, 6, 7], amount: 3_000_000 }],
        gallery: [],
      },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
    expect(JSON.stringify(res.json())).toContain('"path":"offering"');
  });

  it('returns offering in the list and the detail, null for a retail product', async () => {
    const retail = ProductDto.parse(
      (
        await call(h, 'POST', '/products', {
          code: 'SRM',
          name: 'Sữa rửa mặt',
          variants: [{ sku: 'SRM-1', price: 250_000 }],
        })
      ).json(),
    );
    expect((await get(retail.id)).offering).toBeNull();
    const list = ProductListResponse.parse((await call(h, 'GET', '/products?pageSize=100')).json());
    const byCode = new Map(list.data.map((p) => [p.code, p.offering]));
    expect(byCode.get('SRM')).toBeNull();
    expect(byCode.get('CS-MAT')).toMatchObject({ kind: 'service', durationMinutes: 60 });
  });

  it('lists compact summary rows, at most PRODUCT_SUMMARY_PAGE_MAX a page (QA retest N1)', async () => {
    const res = await call(h, 'GET', '/products?fields=summary&pageSize=100');
    expect(res.statusCode).toBe(200);
    const page = ProductSummaryListResponse.strict().parse(res.json());
    expect(page.pageSize).toBe(PRODUCT_SUMMARY_PAGE_MAX);
    const row = page.data.find((p) => p.code === 'CS-MAT');
    expect(row?.offering).toMatch(/^service, 60 min/);
    expect(Object.keys(row ?? {})).not.toContain('description');
    expect(page.data.find((p) => p.code === 'SRM')).toMatchObject({ offering: '', priceNote: '' });
  });

  it('leaves offering products out of the low-stock figures and refuses their stock', async () => {
    const make = async (code: string) => {
      const p = ProductDto.parse(
        (
          await call(h, 'POST', '/products', {
            code,
            name: code,
            variants: [{ sku: `${code}-1`, price: 100_000 }],
          })
        ).json(),
      );
      const stock = await call(h, 'POST', `/products/${p.id}/stock`, {
        variantId: p.variants[0]!.id,
        warehouseId: warehouse.id,
        onHand: 1,
      });
      expect(stock.statusCode).toBe(200);
      return get(p.id);
    };
    await make('LOW-RETAIL');
    const turned = await make('LOW-SERVICE');
    // A retail product that becomes a service keeps its old stock rows.
    const res = await call(h, 'PUT', `/products/${turned.id}`, {
      ...sameBody(turned),
      offering: facial,
    });
    expect(res.statusCode).toBe(200);

    const low = await commerce().lowStock(ws, { threshold: 5, limit: 20 });
    expect(low.items.map((i) => i.sku)).toContain('LOW-RETAIL-1');
    expect(low.items.map((i) => i.sku)).not.toContain('LOW-SERVICE-1');

    const refused = await call(h, 'POST', `/products/${turned.id}/stock`, {
      variantId: turned.variants[0]!.id,
      warehouseId: warehouse.id,
      onHand: 5,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ error: { code: 'VALIDATION_FAILED' } });
  });

  it('refuses a bot order for an offering variant with not_sold', async () => {
    const bot = BotDto.parse(
      (await call(h, 'POST', '/bots', { name: 'Bot', industry: 'fashion' })).json(),
    );
    const res = await commerce().prepareBotOrder(ws, {
      botId: bot.id,
      conversationId: newId(),
      channel: 'facebook',
      items: [{ sku: 'CS-MAT-1', qty: 1 }],
      recipient: { name: 'Mai', phone: '0912 000 111', address: '5 Hàng Bài, Hà Nội' },
      shippingFeeVnd: 0,
    });
    expect(res).toEqual({ ok: false, problems: [{ code: 'not_sold', sku: 'CS-MAT-1' }] });
  });

  it('keeps the offering when a PMS sync updates the product', async () => {
    const synced = await sync().upsertExternalProduct(ws, 'kiotviet', {
      externalId: '5001',
      name: 'Gội đầu dưỡng sinh',
      description: '',
      category: null,
      active: true,
      imageUrls: [],
      variants: [
        { externalId: '6001', sku: 'GD-1', name: '', price: 150_000, weightGram: 0, position: 0 },
      ],
    });
    const productId = synced.productId!;
    const before = await get(productId);
    // Rapiz owns the offering of a synced product: staff may set it (ADR-017 lock is untouched).
    const set = await call(h, 'PUT', `/products/${productId}`, {
      ...sameBody(before),
      offering: { kind: 'service', durationMinutes: 45 },
    });
    expect(set.statusCode).toBe(200);

    await sync().upsertExternalProduct(ws, 'kiotviet', {
      externalId: '5001',
      name: 'Gội đầu dưỡng sinh thảo dược',
      description: 'Mới',
      category: null,
      active: true,
      imageUrls: [],
      variants: [
        { externalId: '6001', sku: 'GD-1', name: '', price: 180_000, weightGram: 0, position: 0 },
      ],
    });
    const after = await get(productId);
    expect(after.name).toBe('Gội đầu dưỡng sinh thảo dược');
    expect(after.offering).toMatchObject({ kind: 'service', durationMinutes: 45 });
  });
});
