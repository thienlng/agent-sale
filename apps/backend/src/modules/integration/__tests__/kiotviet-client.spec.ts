import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  KiotVietAuthError,
  KiotVietPermissionError,
  KiotVietRetailerError,
  KiotVietUnavailableError,
} from '../domain/integration.errors.js';
import { KiotVietClient } from '../infrastructure/clients/kiotviet-client.js';
import { startFakeKiotViet, type FakeKiotViet, type FakeKvProduct } from './fake-kiotviet.js';

const product = (id: number, extra: Partial<FakeKvProduct> = {}): FakeKvProduct => ({
  id,
  code: `SP${String(id).padStart(3, '0')}`,
  name: `Product ${id}`,
  basePrice: '150000',
  allowsSale: true,
  images: ['https://cdn.kiotviet.vn/a.jpg'],
  inventories: [{ branchId: 1, onHand: 5, reserved: 1 }],
  unknownField: 'kept',
  ...extra,
});

describe('KiotVietClient', () => {
  let fake: FakeKiotViet;
  let clock: number;
  let sleeps: number[];
  let client: KiotVietClient;
  const creds = { retailer: 'shopdemo', clientId: 'client-1', clientSecret: 'secret-1' };

  const makeClient = (): KiotVietClient =>
    new KiotVietClient({
      tokenUrl: fake.tokenUrl,
      apiUrl: fake.apiUrl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
        clock += ms;
      },
    });

  beforeEach(async () => {
    fake = await startFakeKiotViet({
      products: Array.from({ length: 150 }, (_, i) => product(i + 1)),
      removedProductIds: [999],
      onHands: [
        {
          productId: 1,
          inventories: [
            { branchId: 1, onHand: 3, reserved: 0 },
            { branchId: 2, onHand: 7, reserved: 2 },
          ],
        },
      ],
      removedOnHandIds: [42],
    });
    clock = 1_000_000;
    sleeps = [];
    client = makeClient();
  });

  afterEach(async () => {
    await fake.close();
  });

  it('sends the token form and the Retailer/Bearer headers', async () => {
    const branches = await client.branches(creds);

    expect(branches).toEqual([{ id: 1, name: 'Chi nhánh trung tâm', address: '1 Lê Lợi' }]);
    const call = fake.apiRequests('/branches')[0];
    expect(call?.retailer).toBe('shopdemo');
    expect(call?.authorization).toBe('Bearer tok-1');
    expect(fake.requests[0]?.body).toMatchObject({
      scopes: 'PublicApi.Access',
      grant_type: 'client_credentials',
      client_id: 'client-1',
      client_secret: 'secret-1',
    });
  });

  it('reuses the token and asks for one only once under concurrency', async () => {
    await Promise.all([client.branches(creds), client.branches(creds), client.listWebhooks(creds)]);
    await client.branches(creds);

    expect(fake.tokensIssued()).toBe(1);
  });

  it('refreshes the token 300 s before it expires', async () => {
    fake.state.tokenTtlSeconds = 400;
    await client.branches(creds);
    clock += 99_000;
    await client.branches(creds);
    expect(fake.tokensIssued()).toBe(1);

    clock += 2_000;
    await client.branches(creds);
    expect(fake.tokensIssued()).toBe(2);
  });

  it('asks for a new token when the secret changes', async () => {
    await client.branches(creds);
    fake.state.clientSecret = 'secret-2';
    await client.branches({ ...creds, clientSecret: 'secret-2' });

    expect(fake.tokensIssued()).toBe(2);
  });

  it('reads product pages with removed ids and tolerant fields', async () => {
    const first = await client.products(creds, { currentItem: 0, pageSize: 100 });
    const second = await client.products(creds, {
      currentItem: 100,
      pageSize: 100,
      lastModifiedFrom: new Date('2026-10-01T00:00:00Z'),
    });

    expect(first.total).toBe(150);
    expect(first.data).toHaveLength(100);
    expect(second.data).toHaveLength(50);
    expect(first.removedIds).toEqual([999]);
    expect(first.data[0]).toMatchObject({
      id: 1,
      code: 'SP001',
      basePrice: 150_000,
      inventories: [{ branchId: 1, onHand: 5, reserved: 1 }],
      unknownField: 'kept',
    });
    const q = fake.apiRequests('/products')[1]?.query;
    expect(q).toMatchObject({
      currentItem: '100',
      pageSize: '100',
      includeInventory: 'true',
      includeRemoveIds: 'true',
      lastModifiedFrom: '2026-10-01T00:00:00.000Z',
    });
  });

  it('returns a product by id, or null when KiotViet does not know it', async () => {
    expect(await client.productById(creds, 2)).toMatchObject({ id: 2, code: 'SP002' });
    expect(await client.productById(creds, 4040)).toBeNull();
  });

  it('reads on-hand pages for the given branches', async () => {
    const page = await client.onHands(creds, { currentItem: 0, pageSize: 100, branchIds: [2] });

    expect(page).toEqual({
      total: 1,
      removedIds: [42],
      data: [{ productId: 1, inventories: [{ branchId: 2, onHand: 7, reserved: 2 }] }],
    });
    expect(fake.apiRequests('/productOnHands')[0]?.query.branchIds).toBe('2');
  });

  it('iterates product codes page by page and stops when the caller stops', async () => {
    const codes: string[] = [];
    for await (const code of client.productCodes(creds)) codes.push(code);
    expect(codes).toHaveLength(150);
    expect(codes[149]).toBe('SP150');
    expect(fake.apiRequests('/products')).toHaveLength(2);

    const early: string[] = [];
    for await (const code of client.productCodes(creds)) {
      early.push(code);
      if (early.length === 3) break;
    }
    expect(fake.apiRequests('/products')).toHaveLength(3);
  });

  it('registers, lists and deletes webhooks', async () => {
    const id = await client.registerWebhook(creds, {
      type: 'product.update',
      url: 'https://rapiz.test/hooks/kiotviet/abc',
      secretBase64: 'c2VjcmV0LXNlY3JldA==',
    });

    expect(fake.apiRequests('/webhooks')[0]?.body).toEqual({
      Webhook: {
        Type: 'product.update',
        Url: 'https://rapiz.test/hooks/kiotviet/abc',
        IsActive: true,
        Description: 'Rapiz',
        Secret: 'c2VjcmV0LXNlY3JldA==',
      },
    });
    expect(await client.listWebhooks(creds)).toEqual([
      { id, type: 'product.update', url: 'https://rapiz.test/hooks/kiotviet/abc' },
    ]);
    await client.deleteWebhook(creds, id);
    expect(fake.state.webhooks).toEqual([]);
  });

  it('retries 429 and 5xx with 1 s / 4 s backoff, then succeeds', async () => {
    fake.state.apiFailures = [429, 503];

    await expect(client.branches(creds)).resolves.toHaveLength(1);
    expect(sleeps).toEqual([1_000, 4_000]);
  });

  it('gives up after three retries with KiotVietUnavailableError', async () => {
    fake.state.apiFailures = [429, 500, 502, 503];

    await expect(client.branches(creds)).rejects.toBeInstanceOf(KiotVietUnavailableError);
    expect(sleeps).toEqual([1_000, 4_000, 15_000]);
    expect(fake.apiRequests('/branches')).toHaveLength(4);
  });

  it('treats network failures and timeouts as retryable', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError' }));
    const offline = new KiotVietClient({
      tokenUrl: fake.tokenUrl,
      apiUrl: fake.apiUrl,
      fetchImpl,
      now: () => clock,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    await expect(offline.branches(creds)).rejects.toBeInstanceOf(KiotVietUnavailableError);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it('maps a rejected token call to KiotVietAuthError', async () => {
    await expect(client.branches({ ...creds, clientSecret: 'wrong' })).rejects.toBeInstanceOf(
      KiotVietAuthError,
    );
    fake.state.tokenFailures = [401];
    await expect(client.branches(creds)).rejects.toBeInstanceOf(KiotVietAuthError);
  });

  it('refreshes once on 401, then maps a second 401 to KiotVietRetailerError', async () => {
    await expect(client.branches({ ...creds, retailer: 'nope' })).rejects.toBeInstanceOf(
      KiotVietRetailerError,
    );
    expect(fake.tokensIssued()).toBe(2);
    expect(fake.apiRequests('/branches')).toHaveLength(2);
  });

  it('recovers from a revoked token with one refresh', async () => {
    await client.branches(creds);
    fake.revokeTokens();

    await expect(client.branches(creds)).resolves.toHaveLength(1);
    expect(fake.tokensIssued()).toBe(2);
  });

  it('maps 403 to KiotVietPermissionError naming the resource', async () => {
    fake.state.forbiddenPaths = ['/webhooks'];

    const error = await client.listWebhooks(creds).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(KiotVietPermissionError);
    expect((error as KiotVietPermissionError).missing).toEqual(['webhooks']);
  });

  it('waits for the per-store budget once the burst is spent', async () => {
    for (let i = 0; i < 10; i += 1) await client.productById(creds, 1);
    expect(sleeps).toEqual([]);

    await client.productById(creds, 1);
    expect(sleeps).toHaveLength(1);
    expect(sleeps[0]).toBe(800);

    // Another store has its own bucket.
    fake.state.retailer = 'other';
    await client.productById({ ...creds, retailer: 'other' }, 1);
    expect(sleeps).toHaveLength(1);
  });

  it('never puts the secret or token in log output', async () => {
    const spies = (['log', 'warn', 'error', 'debug'] as const).map((m) =>
      vi.spyOn(Logger.prototype, m).mockImplementation(() => undefined),
    );
    fake.state.apiFailures = [500];
    await client.branches(creds);
    await client.branches({ ...creds, clientSecret: 'wrong' }).catch(() => undefined);
    await client.branches({ ...creds, retailer: 'nope' }).catch(() => undefined);

    const output = JSON.stringify(spies.flatMap((s) => s.mock.calls));
    spies.forEach((s) => s.mockRestore());
    expect(output).toContain('500');
    expect(output).not.toContain('secret-1');
    expect(output).not.toContain('tok-1');
  });
});
