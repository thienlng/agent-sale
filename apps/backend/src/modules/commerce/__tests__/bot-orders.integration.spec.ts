import {
  AuthResponse,
  BootstrapResponse,
  BotDto,
  OrderDto,
  OrderListResponse,
  OrderReviewCountResponse,
  ProductDto,
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
import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';
import { createHttpApp } from '../../../bootstrap.js';
import { DB_TENANT } from '../../../common/db/db.module.js';
import { COMMERCE_FACADE, type CommerceFacade } from '../api/index.js';

/** Bot orders on a real Postgres: forced RLS on drafts, confirmation in one transaction, review. */
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
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT';
const http = () => app.getHttpAdapter().getInstance();
const call = (h: Headers, method: Method, url: string, payload?: object) =>
  http().inject({ method, url: `/api/v1${url}`, headers: h, ...(payload ? { payload } : {}) });
const facade = () => app.get<CommerceFacade>(COMMERCE_FACADE, { strict: false });

let signups = 0;
async function owner(email: string): Promise<Headers> {
  const signup = await http().inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    remoteAddress: `10.2.0.${++signups}`,
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

async function shop(email: string) {
  const h = await owner(email);
  const ws = workspaceId(h['x-workspace-id']!);
  const warehouse = WarehouseDto.parse(
    (await call(h, 'POST', '/warehouses', { name: 'Kho chính' })).json(),
  );
  const bot = BotDto.parse(
    (await call(h, 'POST', '/bots', { name: 'Bot Lan', industry: 'fashion' })).json(),
  );
  const created = await call(h, 'POST', '/products', {
    code: 'TG01',
    name: 'Thú gỗ xếp thăng bằng',
    imageUrls: [`${MEDIA_URL}/products/${ws}/thu-go.jpg`],
    variants: [{ sku: 'TG-01', price: 880_000, cost: 400_000 }],
  });
  expect(created.statusCode).toBe(201);
  const product = ProductDto.parse(created.json());
  const variant = product.variants[0]!;
  const stock = await call(h, 'POST', `/products/${product.id}/stock`, {
    variantId: variant.id,
    warehouseId: warehouse.id,
    onHand: 5,
  });
  expect(stock.statusCode).toBe(200);
  return { h, ws, bot, product, variant, warehouse };
}

const recipient = { name: 'Lan', phone: '0912 345 678', address: '12 Lý Thường Kiệt, Hà Nội' };
const prepare = (ws: WorkspaceId, botId: string, conversationId: string, qty: number) =>
  facade().prepareBotOrder(ws, {
    botId,
    conversationId,
    channel: 'facebook',
    items: [{ sku: 'tg-01', qty }],
    recipient,
    shippingFeeVnd: 30_000,
  });

describe('bot orders on Postgres', () => {
  let a: Awaited<ReturnType<typeof shop>>;
  let b: Awaited<ReturnType<typeof shop>>;

  beforeAll(async () => {
    a = await shop('bot-orders-a@shop.vn');
    b = await shop('bot-orders-b@shop.vn');
  });

  it('keeps drafts to their workspace under forced RLS (read and write denied)', async () => {
    const conversationId = newId();
    expect(await prepare(a.ws, a.bot.id, conversationId, 1)).toMatchObject({ ok: true });
    const db = app.get<Database>(DB_TENANT, { strict: false });
    const d = schema.botOrderDrafts;

    const own = await withTenant(db, a.ws, (tx) => tx.select().from(d));
    expect(own.map((r) => r.conversationId)).toEqual([conversationId]);
    expect(await withTenant(db, b.ws, (tx) => tx.select().from(d))).toEqual([]);
    expect(await facade().hasBotOrderDraft(b.ws, conversationId)).toEqual({
      pending: false,
      storedAt: null,
    });

    // Another tenant cannot change, delete or plant a row for workspace A.
    const updated = await withTenant(db, b.ws, (tx) =>
      tx.update(d).set({ note: 'hijack' }).where(eq(d.conversationId, conversationId)).returning(),
    );
    expect(updated).toEqual([]);
    const deleted = await withTenant(db, b.ws, (tx) =>
      tx.delete(d).where(eq(d.conversationId, conversationId)).returning(),
    );
    expect(deleted).toEqual([]);
    await expect(
      withTenant(db, b.ws, (tx) =>
        tx.insert(d).values({
          workspaceId: a.ws,
          conversationId: newId(),
          botId: a.bot.id,
          channel: 'facebook',
          lines: [],
          recipient,
          amountsHash: 'x',
          expiresAt: new Date(Date.now() + 60_000),
        }),
      ),
    ).rejects.toThrow();
    // B's bot cannot confirm A's conversation either.
    expect(
      await facade().confirmBotOrder(b.ws, { botId: b.bot.id, botName: 'Bot', conversationId }),
    ).toEqual({ ok: false, code: 'nothing_pending' });
    expect(await facade().cancelBotOrderDraft(a.ws, conversationId)).toBe(true);
  });

  it('confirms in one transaction: order, reservation, history, review and list', async () => {
    const conversationId = newId();
    const prepared = await prepare(a.ws, a.bot.id, conversationId, 2);
    expect(prepared).toMatchObject({ ok: true, productIds: [a.product.id] });
    if (prepared.ok) expect(prepared.summaryText).toContain('Tổng: 1.790.000đ');

    const confirmed = await facade().confirmBotOrder(a.ws, {
      botId: a.bot.id,
      botName: 'Bot Lan',
      conversationId,
    });
    expect(confirmed).toMatchObject({ ok: true, orderCode: expect.stringMatching(/^DH\d{6}$/) });
    if (!confirmed.ok) return;
    // The draft is gone with the order: confirming again has nothing to confirm.
    expect(
      await facade().confirmBotOrder(a.ws, { botId: a.bot.id, botName: 'Bot Lan', conversationId }),
    ).toEqual({ ok: false, code: 'nothing_pending' });

    const order = OrderDto.parse((await call(a.h, 'GET', `/orders/${confirmed.orderId}`)).json());
    expect(order).toMatchObject({
      status: 'new',
      source: 'facebook',
      createdByKind: 'bot',
      createdByName: 'Bot Lan',
      reviewState: 'pending',
      conversationId,
      stockState: 'reserved',
      recipient: { name: 'Lan', phone: '0912345678', address: recipient.address },
    });
    expect(order.history.map((x) => x.note)).toEqual(['Bot tạo đơn từ hội thoại']);
    expect(order.itemCount).toBe(1);
    expect(order.itemsPreview[0]?.imageUrl).toBe(`${MEDIA_URL}/products/${a.ws}/thu-go.jpg`);
    const product = ProductDto.parse((await call(a.h, 'GET', `/products/${a.product.id}`)).json());
    expect(product.variants[0]?.stock[0]).toMatchObject({ onHand: 5, reserved: 2 });
    expect(await facade().hasBotOrderDraft(a.ws, conversationId)).toMatchObject({
      pending: false,
    });

    const count = () =>
      call(a.h, 'GET', '/orders/review-count').then((r) =>
        OrderReviewCountResponse.parse(r.json()),
      );
    expect(await count()).toEqual({ pending: 1 });
    const list = OrderListResponse.parse((await call(a.h, 'GET', '/orders?review=pending')).json());
    expect(list.data.map((o) => o.id)).toEqual([order.id]);
    expect(list.data[0]?.itemsPreview[0]).toEqual({
      name: 'Thú gỗ xếp thăng bằng',
      qty: 2,
      variantName: null,
      unitPrice: 880_000,
      imageUrl: `${MEDIA_URL}/products/${a.ws}/thu-go.jpg`,
    });

    const approved = await call(a.h, 'POST', `/orders/${order.id}/approve`, { approve: true });
    expect(approved.statusCode).toBe(200);
    expect(OrderDto.parse(approved.json())).toMatchObject({
      reviewState: 'approved',
      reviewedByName: 'Chủ shop',
      reviewedAt: expect.any(String),
    });
    expect(await count()).toEqual({ pending: 0 });
    const undo = await call(a.h, 'POST', `/orders/${order.id}/approve`, { approve: false });
    expect(OrderDto.parse(undo.json()).reviewState).toBe('pending');
    // Cancelling rejects the order: it leaves the review queue.
    await call(a.h, 'POST', `/orders/${order.id}/status`, { status: 'cancelled' });
    expect(await count()).toEqual({ pending: 0 });
  });

  it('rechecks stock inside the confirming transaction', async () => {
    const conversationId = newId();
    expect(await prepare(b.ws, b.bot.id, conversationId, 4)).toMatchObject({ ok: true });
    const staffOrder = await call(b.h, 'POST', '/orders', {
      source: 'hotline',
      warehouseId: b.warehouse.id,
      customer: { name: 'Bình' },
      recipient: { name: 'Bình' },
      items: [{ variantId: b.variant.id, qty: 2 }],
    });
    expect(staffOrder.statusCode).toBe(201);
    expect(OrderDto.parse(staffOrder.json()).createdByKind).toBe('agent');
    expect(
      await facade().confirmBotOrder(b.ws, { botId: b.bot.id, botName: 'Bot', conversationId }),
    ).toEqual({ ok: false, code: 'insufficient_stock' });
    const list = OrderListResponse.parse((await call(b.h, 'GET', '/orders')).json());
    expect(list.data).toHaveLength(1);
  });

  it('refuses to approve a staff order and checks membership', async () => {
    const list = OrderListResponse.parse((await call(b.h, 'GET', '/orders')).json());
    const staffOrder = list.data[0]!;
    const refused = await call(b.h, 'POST', `/orders/${staffOrder.id}/approve`, { approve: true });
    expect(refused.statusCode).toBe(409);
    // A member of another workspace cannot reach it (non-members get 404, nothing is revealed).
    const foreign = await call(
      { ...a.h, 'x-workspace-id': b.ws },
      'POST',
      `/orders/${staffOrder.id}/approve`,
      { approve: true },
    );
    expect(foreign.statusCode).toBe(404);
    const anonymous = await http().inject({
      method: 'POST',
      url: `/api/v1/orders/${staffOrder.id}/approve`,
      payload: { approve: true },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('makes a new order when the same basket is ordered again in the same conversation', async () => {
    const conversationId = newId();
    const confirm = () =>
      facade().confirmBotOrder(a.ws, { botId: a.bot.id, botName: 'Bot Lan', conversationId });
    await prepare(a.ws, a.bot.id, conversationId, 1);
    const first = await confirm();
    await prepare(a.ws, a.bot.id, conversationId, 1);
    const second = await confirm();
    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true });
    if (first.ok && second.ok) expect(second.orderId).not.toBe(first.orderId);
  });
});

describe('bot orders under concurrency on Postgres', () => {
  let c: Awaited<ReturnType<typeof shop>>;
  let codes = 0;

  beforeAll(async () => {
    c = await shop('bot-orders-race@shop.vn');
  });

  /** A product with `onHand` units of one variant, sold under its own SKU. */
  async function stocked(onHand: number) {
    const sku = `RACE-${++codes}`;
    const created = await call(c.h, 'POST', '/products', {
      code: `R${codes}`,
      name: `Hàng giới hạn ${codes}`,
      variants: [{ sku, price: 100_000 }],
    });
    const product = ProductDto.parse(created.json());
    const variant = product.variants[0]!;
    await call(c.h, 'POST', `/products/${product.id}/stock`, {
      variantId: variant.id,
      warehouseId: c.warehouse.id,
      onHand,
    });
    const stockOf = async () =>
      ProductDto.parse((await call(c.h, 'GET', `/products/${product.id}`)).json()).variants[0]!
        .stock[0];
    return { sku, product, variant, stockOf };
  }
  const draft = (conversationId: string, sku: string, qty: number) =>
    facade().prepareBotOrder(c.ws, {
      botId: c.bot.id,
      conversationId,
      channel: 'website',
      items: [{ sku, qty }],
      recipient,
      shippingFeeVnd: null,
    });
  const confirm = (conversationId: string) =>
    facade().confirmBotOrder(c.ws, { botId: c.bot.id, botName: 'Bot', conversationId });

  it('confirms one draft once when two confirmations race', async () => {
    const item = await stocked(5);
    const conversationId = newId();
    expect(await draft(conversationId, item.sku, 1)).toMatchObject({ ok: true });
    const results = await Promise.all([confirm(conversationId), confirm(conversationId)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: 'nothing_pending' }]);
    expect(await item.stockOf()).toMatchObject({ onHand: 5, reserved: 1 });
  });

  it('sells the last unit once when two conversations race for it', async () => {
    const item = await stocked(1);
    const [one, two] = [newId(), newId()];
    expect(await draft(one, item.sku, 1)).toMatchObject({ ok: true });
    expect(await draft(two, item.sku, 1)).toMatchObject({ ok: true });
    const results = await Promise.all([confirm(one), confirm(two)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, code: 'insufficient_stock' }]);
    expect(await item.stockOf()).toMatchObject({ onHand: 1, reserved: 1 });
  });

  it('lets a bot confirmation and a staff order of the same goods finish without deadlock', async () => {
    const other = await stocked(10);
    const item = await stocked(10);
    const conversationId = newId();
    // The bot locks the variants in id order; the staff order lists them the other way round.
    const res = await facade().prepareBotOrder(c.ws, {
      botId: c.bot.id,
      conversationId,
      channel: 'website',
      items: [
        { sku: item.sku, qty: 2 },
        { sku: other.sku, qty: 2 },
      ],
      recipient,
      shippingFeeVnd: null,
    });
    expect(res).toMatchObject({ ok: true });
    const staff = call(c.h, 'POST', '/orders', {
      source: 'hotline',
      warehouseId: c.warehouse.id,
      customer: { name: 'Bình' },
      recipient: { name: 'Bình' },
      items: [
        { variantId: other.variant.id, qty: 3 },
        { variantId: item.variant.id, qty: 3 },
      ].sort((x, y) => y.variantId.localeCompare(x.variantId)),
    });
    const [bot, staffRes] = await Promise.all([confirm(conversationId), staff]);
    expect(bot).toMatchObject({ ok: true });
    expect(staffRes.statusCode).toBe(201);
    expect(await item.stockOf()).toMatchObject({ onHand: 10, reserved: 5 });
    expect(await other.stockOf()).toMatchObject({ onHand: 10, reserved: 5 });
    const codesSeen = OrderListResponse.parse((await call(c.h, 'GET', '/orders')).json()).data.map(
      (o) => o.code,
    );
    expect(new Set(codesSeen).size).toBe(codesSeen.length);
  });
});
