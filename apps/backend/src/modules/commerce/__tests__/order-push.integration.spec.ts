import {
  AuthResponse,
  BootstrapResponse,
  BotDto,
  OrderDto,
  OrderListResponse,
  ProductDto,
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
  withTenant,
} from '@agent-sales/db';
import { newId, workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { startTestPostgres, type TestPostgres } from '@agent-sales/testing';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppModule } from '../../../app.module.js';
import { createHttpApp } from '../../../bootstrap.js';
import { DB_TENANT } from '../../../common/db/db.module.js';
import {
  CATALOG_SYNC_FACADE,
  type CatalogSyncFacade,
  COMMERCE_FACADE,
  type CommerceFacade,
  ORDER_PUSH_FACADE,
  type OrderPushFacade,
} from '../api/index.js';

/** Pushing orders to a PMS on a real Postgres: claim, payload, stock hand-over, PMS status. */
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
const push = () => app.get<OrderPushFacade>(ORDER_PUSH_FACADE, { strict: false });
const sync = () => app.get<CatalogSyncFacade>(CATALOG_SYNC_FACADE, { strict: false });
const commerce = () => app.get<CommerceFacade>(COMMERCE_FACADE, { strict: false });
const db = () => app.get<Database>(DB_TENANT, { strict: false });

async function owner(email: string): Promise<Headers> {
  const signup = await http().inject({
    method: 'POST',
    url: '/api/v1/auth/signup',
    remoteAddress: '10.4.0.1',
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

describe('order push facade on Postgres', () => {
  let h: Headers;
  let ws: WorkspaceId;
  let warehouse: WarehouseDto;
  let bot: BotDto;
  let linked: ProductDto;
  let rapizOnly: ProductDto;
  const since = new Date(Date.now() - 60_000);
  const ids: Record<string, string> = {};

  const order = async (id: string) =>
    OrderDto.parse((await call(h, 'GET', `/orders/${id}`)).json());
  const stock = async () =>
    ProductDto.parse((await call(h, 'GET', `/products/${linked.id}`)).json()).variants[0]?.stock[0];
  const staffOrder = async (variantId: string, qty = 2) => {
    const res = await call(h, 'POST', '/orders', {
      source: 'hotline',
      warehouseId: warehouse.id,
      customer: { name: 'Lan', phone: '0912345678' },
      recipient: { name: 'Hoa', phone: '0987654321', address: '12 Lý Thường Kiệt' },
      items: [{ variantId, qty }],
      noteInternal: 'Gói kỹ',
    });
    expect(res.statusCode).toBe(201);
    return OrderDto.parse(res.json()).id;
  };
  const botOrder = async () => {
    const conversationId = newId();
    const prepared = await commerce().prepareBotOrder(ws, {
      botId: bot.id,
      conversationId,
      channel: 'facebook',
      items: [{ sku: 'AT-S', qty: 1 }],
      recipient: { name: 'Mai', phone: '0912 000 111', address: '5 Hàng Bài, Hà Nội' },
      shippingFeeVnd: 30_000,
    });
    expect(prepared).toMatchObject({ ok: true });
    const confirmed = await commerce().confirmBotOrder(ws, {
      botId: bot.id,
      botName: 'Bot',
      conversationId,
    });
    if (!confirmed.ok) throw new Error(`bot order not confirmed: ${confirmed.code}`);
    return confirmed.orderId;
  };
  const setOrder = (id: string, set: Partial<typeof schema.orders.$inferInsert>) =>
    withTenant(db(), ws, (tx) => tx.update(schema.orders).set(set).where(eq(schema.orders.id, id)));

  beforeAll(async () => {
    h = await owner('order-push@shop.vn');
    ws = workspaceId(h['x-workspace-id']!);
    warehouse = WarehouseDto.parse(
      (await call(h, 'POST', '/warehouses', { name: 'Kho chính' })).json(),
    );
    bot = BotDto.parse(
      (await call(h, 'POST', '/bots', { name: 'Bot', industry: 'fashion' })).json(),
    );
    const res = await sync().upsertExternalProduct(ws, 'kiotviet', {
      externalId: '1001',
      name: 'Áo thun',
      description: '',
      category: null,
      active: true,
      imageUrls: [],
      variants: [
        {
          externalId: '2001',
          sku: 'AT-S',
          name: 'S',
          price: 150_000,
          weightGram: 200,
          position: 0,
        },
      ],
    });
    await sync().setExternalStock(ws, 'kiotviet', [{ externalVariantId: '2001', available: 10 }]);
    linked = ProductDto.parse((await call(h, 'GET', `/products/${res.productId}`)).json());
    const created = await call(h, 'POST', '/products', {
      code: 'QJ',
      name: 'Quần jean',
      variants: [{ sku: 'QJ-30', price: 300_000 }],
    });
    rapizOnly = ProductDto.parse(created.json());
  });

  it('claims staff orders and approved, settled bot orders once, even under concurrency', async () => {
    ids['staff'] = await staffOrder(linked.variants[0]!.id);
    ids['botPending'] = await botOrder();
    ids['botFresh'] = await botOrder();
    ids['botSettled'] = await botOrder();
    for (const id of [ids['botFresh'], ids['botSettled']]) {
      const approved = await call(h, 'POST', `/orders/${id}/approve`, { approve: true });
      expect(approved.statusCode).toBe(200);
    }
    await setOrder(ids['botSettled']!, { reviewedAt: new Date(Date.now() - 10_000) });
    ids['old'] = await staffOrder(linked.variants[0]!.id, 1);
    await setOrder(ids['old']!, { createdAt: new Date(since.getTime() - 1_000) });
    ids['cancelled'] = await staffOrder(linked.variants[0]!.id, 1);
    await call(h, 'POST', `/orders/${ids['cancelled']}/status`, { status: 'cancelled' });

    const runs = await Promise.all(
      Array.from({ length: 4 }, () => push().claimOrdersForPush(ws, 'kiotviet', since, 10)),
    );
    const claimed = runs.flat();
    expect(claimed.sort()).toEqual([ids['staff']!, ids['botSettled']!].sort());
    expect(await push().claimOrdersForPush(ws, 'kiotviet', since, 10)).toEqual([]);
    expect((await order(ids['staff']!)).external).toEqual({
      state: 'pending',
      code: null,
      status: null,
      error: null,
    });
    expect((await order(ids['botFresh']!)).external).toBeNull();
  });

  it('builds the payload of a pending order and names an unlinked product', async () => {
    expect(await push().pushableOrder(ws, ids['botPending']!)).toBeNull();
    expect(await push().pushableOrder(ws, newId())).toBeNull();
    const pushable = await push().pushableOrder(ws, ids['staff']!);
    expect(pushable).toMatchObject({
      order: {
        id: ids['staff'],
        note: 'Gói kỹ',
        lines: [
          {
            externalVariantId: '2001',
            sku: 'AT-S',
            name: 'Áo thun – S',
            qty: 2,
            unitPrice: 150_000,
            lineDiscount: 0,
          },
        ],
        customer: { name: 'Lan', phone: '0912345678' },
        recipient: { name: 'Hoa', phone: '0987654321', address: '12 Lý Thường Kiệt' },
      },
    });

    // While the push is pending, lines and amounts are frozen; notes stay editable.
    const items = await call(h, 'PATCH', `/orders/${ids['staff']}`, {
      items: [{ variantId: linked.variants[0]!.id, qty: 3 }],
    });
    expect(items.statusCode).toBe(409);
    expect(items.json().error.details).toMatchObject({ reason: 'PUSH_PENDING' });
    for (const body of [{ discountValue: 10_000 }, { shippingFeeCharged: 1 }, { surcharge: 5 }]) {
      expect((await call(h, 'PATCH', `/orders/${ids['staff']}`, body)).statusCode).toBe(409);
    }
    const note = await call(h, 'PATCH', `/orders/${ids['staff']}`, { notePrint: 'Cảm ơn' });
    expect(note.statusCode).toBe(200);

    ids['unlinked'] = await staffOrder(rapizOnly.variants[0]!.id, 1);
    // botFresh may have settled by now: only the new order is certain.
    expect(await push().claimOrdersForPush(ws, 'kiotviet', since, 10)).toContain(ids['unlinked']);
    expect(await push().pushableOrder(ws, ids['unlinked']!)).toEqual({
      problem: { reason: 'unlinked_product', name: 'Quần jean' },
      code: expect.any(String),
    });
  });

  it('marks an order pushed: one release movement, stock handed to the PMS', async () => {
    const id = ids['staff']!;
    // Hold of 2 (staff) + 1 (each bot order still holding).
    const before = await stock();
    const ref = { externalId: '9001', externalCode: 'DHKV0001', externalStatus: 'confirmed' };
    expect(await push().markOrderPushed(ws, id, ref)).toEqual({ cancelled: false });
    expect(await push().markOrderPushed(ws, id, ref)).toEqual({ cancelled: false });
    // Another PMS order for the same Rapiz order: refused, the first refs stay.
    await expect(
      push().markOrderPushed(ws, id, { ...ref, externalId: '9999', externalCode: 'DHKV9999' }),
    ).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'ALREADY_PUSHED', externalCode: 'DHKV0001' },
    });

    const after = await stock();
    expect(after).toMatchObject({ onHand: before?.onHand, reserved: (before?.reserved ?? 0) - 2 });
    const releases = await withTenant(db(), ws, (tx) =>
      tx
        .select()
        .from(schema.inventoryMovements)
        .where(
          and(
            eq(schema.inventoryMovements.refId, id),
            eq(schema.inventoryMovements.reason, 'release'),
          ),
        ),
    );
    expect(releases).toHaveLength(1);
    expect(releases[0]).toMatchObject({ refType: 'order', reservedDelta: -2, onHandDelta: 0 });

    const o = await order(id);
    expect(o.stockState).toBe('external');
    expect(o.external).toEqual({
      state: 'pushed',
      code: 'DHKV0001',
      status: 'confirmed',
      error: null,
    });
    expect(o.history.map((x) => x.note)).toContain('Đã đẩy sang KiotViet (DHKV0001)');
    expect(o.history.filter((x) => x.note?.startsWith('Đã đẩy'))).toHaveLength(1);

    // Lines stay locked; later status changes move no Rapiz stock.
    const edit = await call(h, 'PATCH', `/orders/${id}`, {
      items: [{ variantId: linked.variants[0]!.id, qty: 3 }],
    });
    expect(edit.statusCode).toBe(409);
    const shipped = await call(h, 'POST', `/orders/${id}/status`, { status: 'delivering' });
    expect(shipped.statusCode).toBe(200);
    expect(OrderDto.parse(shipped.json()).stockState).toBe('external');
    expect(await stock()).toEqual(after);

    const list = OrderListResponse.parse((await call(h, 'GET', '/orders')).json());
    expect(list.data.find((x) => x.id === id)?.external?.state).toBe('pushed');
    expect(await push().pushedOrderCount(ws, 'kiotviet')).toBe(1);
  });

  it('applies PMS status changes; a PMS cancellation cancels the order without moving stock', async () => {
    const id = ids['staff']!;
    const before = await stock();
    expect(
      await push().applyExternalOrderStatus(ws, 'kiotviet', 'nope', {
        code: 'completed',
        cancelled: false,
      }),
    ).toBe('unknown');
    expect(
      await push().applyExternalOrderStatus(ws, 'kiotviet', '9001', {
        code: 'delivering',
        cancelled: false,
      }),
    ).toBe('updated');
    expect((await order(id)).external?.status).toBe('delivering');

    expect(
      await push().applyExternalOrderStatus(ws, 'kiotviet', '9001', {
        code: 'cancelled',
        cancelled: true,
      }),
    ).toBe('cancelled');
    const o = await order(id);
    expect(o).toMatchObject({ status: 'cancelled', stockState: 'external' });
    expect(o.external?.status).toBe('cancelled');
    expect(o.history.at(-1)).toMatchObject({
      fromStatus: 'delivering',
      toStatus: 'cancelled',
      note: 'Đơn đã huỷ trên KiotViet',
    });
    expect(await stock()).toEqual(before);
    // Already cancelled: only the status is stored.
    expect(
      await push().applyExternalOrderStatus(ws, 'kiotviet', '9001', {
        code: 'cancelled',
        cancelled: true,
      }),
    ).toBe('updated');
  });

  it('records a failure and requeues only a failed push', async () => {
    const id = ids['unlinked']!;
    await push().markOrderPushFailed(ws, id, {
      code: 'unlinked_product',
      params: { name: 'Quần jean' },
    });
    expect((await order(id)).external).toEqual({
      state: 'failed',
      code: null,
      status: null,
      error: { code: 'unlinked_product', params: { name: 'Quần jean' } },
    });
    expect((await order(id)).stockState).toBe('reserved');

    await push().requeueOrderPush(ws, id);
    expect((await order(id)).external).toBeNull();
    await expect(push().requeueOrderPush(ws, id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(push().requeueOrderPush(ws, ids['staff']!)).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    await expect(push().requeueOrderPush(ws, newId())).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    // Only a pending push can fail: a requeued (null) or failed one is left as it is.
    await push().markOrderPushFailed(ws, id, { code: 'timeout' });
    expect((await order(id)).external).toBeNull();
    // Back in the queue: the next scan claims it again.
    expect(await push().claimOrdersForPush(ws, 'kiotviet', since, 10)).toContain(id);
  });

  it('drops the claim of an order cancelled before its push; reviving it queues it again', async () => {
    const id = await staffOrder(linked.variants[0]!.id, 1);
    expect(await push().claimOrdersForPush(ws, 'kiotviet', since, 10)).toContain(id);
    await call(h, 'POST', `/orders/${id}/status`, { status: 'cancelled' });
    expect(await push().pushableOrder(ws, id)).toBeNull();
    expect((await order(id)).external).toBeNull();
    const [row] = await withTenant(db(), ws, (tx) =>
      tx.select().from(schema.orders).where(eq(schema.orders.id, id)),
    );
    expect(row).toMatchObject({ externalState: null, externalSource: null });

    await call(h, 'POST', `/orders/${id}/status`, { status: 'new' });
    expect(await push().claimOrdersForPush(ws, 'kiotviet', since, 10)).toContain(id);
    expect(await push().pushableOrder(ws, id)).toMatchObject({ order: { id } });
  });

  it('records a push from no claim or of a cancelled order; one Rapiz order per PMS order', async () => {
    const unclaimed = await staffOrder(linked.variants[0]!.id, 1);
    await setOrder(unclaimed, { createdAt: new Date(since.getTime() - 5_000) });
    await push().markOrderPushed(ws, unclaimed, {
      externalId: '9100',
      externalCode: 'DHKV0100',
      externalStatus: 'draft',
    });
    expect((await order(unclaimed)).external?.state).toBe('pushed');

    const cancelled = await staffOrder(linked.variants[0]!.id, 1);
    await setOrder(cancelled, { createdAt: new Date(since.getTime() - 5_000) });
    await call(h, 'POST', `/orders/${cancelled}/status`, { status: 'cancelled' });
    expect(
      await push().markOrderPushed(ws, cancelled, {
        externalId: '9101',
        externalCode: 'DHKV0101',
        externalStatus: 'draft',
      }),
    ).toEqual({ cancelled: true });
    expect(await order(cancelled)).toMatchObject({
      status: 'cancelled',
      stockState: 'external',
      external: { state: 'pushed', code: 'DHKV0101' },
    });

    const other = await staffOrder(linked.variants[0]!.id, 1);
    await setOrder(other, { createdAt: new Date(since.getTime() - 5_000) });
    await expect(
      push().markOrderPushed(ws, other, {
        externalId: '9100',
        externalCode: 'DHKV0100',
        externalStatus: 'draft',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'EXTERNAL_ORDER_LINK_RACE' } });
    expect((await order(other)).external).toBeNull();
    expect((await order(other)).stockState).toBe('reserved');
  });

  it('finds stale pending claims and releases every pending claim of a source', async () => {
    const id = await staffOrder(linked.variants[0]!.id, 1);
    expect(await push().claimOrdersForPush(ws, 'kiotviet', since, 50)).toContain(id);
    // The claim stamps updated_at: not stale yet, stale once the threshold passes it.
    expect(
      await push().stalePendingOrders(ws, 'kiotviet', since, new Date(Date.now() - 60_000), 50),
    ).not.toContain(id);
    expect(
      await push().stalePendingOrders(ws, 'kiotviet', since, new Date(Date.now() + 60_000), 50),
    ).toContain(id);
    expect(
      await push().stalePendingOrders(
        ws,
        'sapo' as 'kiotviet',
        since,
        new Date(Date.now() + 60_000),
        50,
      ),
    ).toEqual([]);

    expect(await push().releasePendingPushes(ws, 'kiotviet')).toBeGreaterThanOrEqual(1);
    expect((await order(id)).external).toBeNull();
    expect(
      await push().stalePendingOrders(ws, 'kiotviet', since, new Date(Date.now() + 60_000), 50),
    ).toEqual([]);
    // Released, it is claimed again by a later connection.
    expect(await push().claimOrdersForPush(ws, 'kiotviet', since, 50)).toContain(id);

    // An order from before the connection (claimed under an earlier one) is never stale for it.
    await setOrder(id, { createdAt: new Date(since.getTime() - 5_000) });
    const future = new Date(Date.now() + 60_000);
    expect(await push().stalePendingOrders(ws, 'kiotviet', since, future, 50)).not.toContain(id);
    expect(
      await push().stalePendingOrders(
        ws,
        'kiotviet',
        new Date(since.getTime() - 60_000),
        future,
        50,
      ),
    ).toContain(id);
  });
});
