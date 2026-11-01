import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KiotVietRejectedError, KiotVietUnavailableError } from '../domain/integration.errors.js';
import { type KvOrderBody } from '../domain/kiotviet-order.js';
import { KiotVietClient } from '../infrastructure/clients/kiotviet-client.js';
import { type FakeKiotViet, startFakeKiotViet } from './fake-kiotviet.js';

const body = (over: Partial<KvOrderBody> = {}): KvOrderBody => ({
  branchId: 1,
  purchaseDate: '2026-11-01T03:04:05.000Z',
  description: 'Rapiz DH0012',
  discount: 0,
  orderDetails: [
    {
      productId: 501,
      productCode: 'AO-S',
      productName: 'Áo',
      quantity: 1,
      price: 100_000,
      discount: 0,
    },
  ],
  orderDelivery: { receiver: 'Lan', contactNumber: '0901', address: '1 Lê Lợi', price: 0 },
  ...over,
});

describe('KiotVietClient orders', () => {
  let fake: FakeKiotViet;
  let sleeps: number[];
  let client: KiotVietClient;
  const creds = { retailer: 'shopdemo', clientId: 'client-1', clientSecret: 'secret-1' };

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fake = await startFakeKiotViet();
    sleeps = [];
    let clock = 1_000_000;
    client = new KiotVietClient({
      tokenUrl: fake.tokenUrl,
      apiUrl: fake.apiUrl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fake.close();
  });

  it('creates an order and answers its id, code and status', async () => {
    const created = await client.createOrder(creds, body());
    expect(created).toEqual({ id: 1, code: 'DH000001', status: 1 });
    expect(fake.apiRequests('/orders')[0]).toMatchObject({ method: 'POST', body: body() });
    expect(fake.state.orders).toHaveLength(1);
  });

  it('maps a 4xx validation answer to KiotVietRejectedError, without retrying', async () => {
    await expect(client.createOrder(creds, body({ orderDetails: [] }))).rejects.toBeInstanceOf(
      KiotVietRejectedError,
    );
    expect(fake.apiRequests('/orders')).toHaveLength(1);
  });

  it('never retries a create that may have landed (5xx): no duplicate order', async () => {
    fake.state.orderCreateFailures = [500];
    await expect(client.createOrder(creds, body())).rejects.toBeInstanceOf(
      KiotVietUnavailableError,
    );
    // KiotViet stored it before failing; the client did not send it twice.
    expect(fake.apiRequests('/orders')).toHaveLength(1);
    expect(fake.state.orders).toHaveLength(1);
    expect(sleeps).toEqual([]);
  });

  it('retries a rate-limited create (KiotViet did not take it)', async () => {
    fake.state.apiFailures = [429];
    expect(await client.createOrder(creds, body())).toMatchObject({ id: 1 });
    expect(fake.apiRequests('/orders')).toHaveLength(2);
    expect(fake.state.orders).toHaveLength(1);
  });

  it('lists recent orders of a branch modified since a time, page by page', async () => {
    for (let i = 0; i < 3; i++)
      await client.createOrder(creds, body({ description: `Rapiz D${i}` }));
    await client.createOrder(creds, body({ branchId: 2 }));
    const since = new Date('2026-01-01T00:00:00.000Z');
    const page = await client.recentOrders(creds, {
      branchId: 1,
      since,
      currentItem: 1,
      pageSize: 500,
    });
    expect(page.total).toBe(3);
    expect(page.data).toEqual([
      { id: 2, code: 'DH000002', status: 1, description: 'Rapiz D1' },
      { id: 3, code: 'DH000003', status: 1, description: 'Rapiz D2' },
    ]);
    expect(fake.apiRequests('/orders').at(-1)?.query).toMatchObject({
      branchIds: '1',
      lastModifiedFrom: since.toISOString(),
      currentItem: '1',
      pageSize: '100',
    });
  });

  it('reads an order by id, or null when KiotViet does not know it', async () => {
    await client.createOrder(creds, body());
    fake.state.orders[0]!.status = 4;
    expect(await client.orderById(creds, 1)).toEqual({ id: 1, code: 'DH000001', status: 4 });
    expect(await client.orderById(creds, 99)).toBeNull();
  });
});
