import { AuthResponse, BootstrapResponse, BotDto, ProductDto } from '@agent-sales/contracts';
import { ensureLoginRoles, migrate, withCredentials } from '@agent-sales/db';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';
import { createHttpApp } from '../../../bootstrap.js';
import { CATALOG_FACADE, type CatalogFacade } from '../api/index.js';

/** Ranked, accent-insensitive, typo-tolerant bot catalog search on a real Postgres. */
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

const http = () => app.getHttpAdapter().getInstance();
type Headers = Record<string, string>;
let signups = 0;

async function owner(email: string): Promise<Headers> {
  const signup = await http().inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    remoteAddress: `10.1.0.${++signups}`,
    payload: {
      name: 'Chủ shop',
      email,
      password: 'a long enough password',
      workspaceName: 'Shop đồ chơi',
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

async function post(h: Headers, url: string, payload: object) {
  return http().inject({ method: 'POST', url: `/api/v1${url}`, headers: h, payload });
}

let codes = 0;
async function product(
  h: Headers,
  name: string,
  extra: object = {},
  price = 100_000,
): Promise<ProductDto> {
  const n = ++codes;
  const r = await post(h, '/products', {
    code: `P${n}`,
    name,
    variants: [{ sku: `P${n}-1`, price }],
    ...extra,
  });
  expect(r.statusCode).toBe(201);
  return ProductDto.parse(r.json());
}

const catalog = () => app.get<CatalogFacade>(CATALOG_FACADE, { strict: false });
const names = (list: ProductDto[]) => list.map((p) => p.name);

describe('bot catalog search on Postgres', () => {
  let ws: WorkspaceId;
  let all: { botId: string; catalogMode: 'all' };
  let selected: { botId: string; catalogMode: 'selected' };
  let animal: ProductDto;
  let cactus: ProductDto;
  let whale: ProductDto;
  let pricey: ProductDto;
  const ANIMAL = 'Thú gỗ xếp thăng bằng — Wooden Animal Balancing Stacker Toy';

  beforeAll(async () => {
    const h = await owner('search@shop.vn');
    const foreign = await owner('search-other@shop.vn');
    ws = workspaceId(h['x-workspace-id']!);
    const bot = BotDto.parse(
      (await post(h, '/bots', { name: 'Bot đồ chơi', industry: 'fashion' })).json(),
    );
    all = { botId: bot.id, catalogMode: 'all' };
    selected = { botId: bot.id, catalogMode: 'selected' };
    animal = await product(h, ANIMAL, { category: 'Đồ chơi gỗ' }, 250_000);
    cactus = await product(h, 'Xương rồng gỗ xếp thăng bằng', {}, 180_000);
    whale = await product(h, 'Cá voi gỗ thăng bằng', {}, 120_000);
    pricey = await product(h, 'Bộ xếp hình thông minh', { category: 'Trí tuệ' }, 900_000);
    await product(h, 'Bút màu sáp', { visibleToBot: false });
    await product(h, 'Bóng gỗ', { status: 'archived' });
    await product(foreign, 'Thú gỗ xếp thăng bằng');
    const put = await http().inject({
      method: 'PUT',
      url: `/api/v1/bots/${bot.id}/products`,
      headers: h,
      payload: { productIds: [cactus.id] },
    });
    expect(put.statusCode).toBe(200);
  });

  it('ranks the accent-free query for the animal stacker first', async () => {
    const rows = await catalog().searchBotCatalog(ws, all, {
      query: 'thu go xep thang bang',
      limit: 8,
    });
    expect(rows[0]?.id).toBe(animal.id);
    expect(rows[0]?.variants[0]?.stock).toBeDefined();
  });

  it('tolerates a typo', async () => {
    const rows = await catalog().searchBotCatalog(ws, all, {
      query: 'thu go sep thang bang',
      limit: 8,
    });
    expect(rows.slice(0, 3).map((p) => p.id)).toContain(animal.id);
  });

  it('matches English words in the name', async () => {
    const rows = await catalog().searchBotCatalog(ws, all, {
      query: 'animal balancing stacker',
      limit: 8,
    });
    expect(rows[0]?.id).toBe(animal.id);
  });

  it('matches the category', async () => {
    const rows = await catalog().searchBotCatalog(ws, all, { query: 'tri tue', limit: 8 });
    expect(rows[0]?.id).toBe(pricey.id);
  });

  it('never returns hidden, archived or other-workspace products', async () => {
    const rows = await catalog().searchBotCatalog(ws, all, { query: 'go thang bang', limit: 50 });
    expect(names(rows)).not.toContain('Bóng gỗ');
    expect(rows.filter((p) => p.name.startsWith('Thú gỗ'))).toHaveLength(1);
    const list = await catalog().searchBotCatalog(ws, all, { limit: 50 });
    expect(names(list)).not.toContain('Bút màu sáp');
    expect(names(list)).not.toContain('Bóng gỗ');
  });

  it('returns no rows for a query without a usable term', async () => {
    expect(await catalog().searchBotCatalog(ws, all, { query: 'a', limit: 8 })).toEqual([]);
  });

  it('filters by price', async () => {
    const rows = await catalog().searchBotCatalog(ws, all, {
      query: 'go thang bang',
      maxPriceVnd: 150_000,
      limit: 8,
    });
    expect(rows.map((p) => p.id)).toEqual([whale.id]);
  });

  it('keeps only the selection for a bot in selected mode', async () => {
    const rows = await catalog().searchBotCatalog(ws, selected, {
      query: 'thu go xep thang bang',
      limit: 8,
    });
    expect(rows.map((p) => p.id)).toEqual([cactus.id]);
    expect(await catalog().countBotCatalog(ws, selected)).toBe(1);
  });

  it('lists every visible active product by name without a query', async () => {
    const rows = await catalog().searchBotCatalog(ws, all, { limit: 300 });
    expect(names(rows)).toEqual([...names(rows)].sort((a, b) => a.localeCompare(b)));
    expect(rows).toHaveLength(4);
    expect(await catalog().countBotCatalog(ws, all)).toBe(4);
  });

  it('fetches products by id in the requested order, skipping unknown and out-of-scope ids', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    const rows = await catalog().getBotProductsByIds(ws, all, [cactus.id, unknown, animal.id]);
    expect(rows.map((p) => p.id)).toEqual([cactus.id, animal.id]);
    const scoped = await catalog().getBotProductsByIds(ws, selected, [animal.id, cactus.id]);
    expect(scoped.map((p) => p.id)).toEqual([cactus.id]);
  });
});
