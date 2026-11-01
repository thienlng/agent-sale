import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KiotVietRejectedError, KiotVietUnavailableError } from '../domain/integration.errors.js';
import { KiotVietClient } from '../infrastructure/clients/kiotviet-client.js';
import { type FakeKiotViet, type FakeKvCustomer, startFakeKiotViet } from './fake-kiotviet.js';

const customer = (id: number, over: Partial<FakeKvCustomer> = {}): FakeKvCustomer => ({
  id,
  code: `KH${id}`,
  name: `Khách ${id}`,
  contactNumber: `09120000${String(id).padStart(2, '0')}`,
  modifiedDate: '2026-11-01T03:00:00.000Z',
  ...over,
});

describe('KiotVietClient customers', () => {
  let fake: FakeKiotViet;
  let client: KiotVietClient;
  const creds = { retailer: 'shopdemo', clientId: 'client-1', clientSecret: 'secret-1' };

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    fake = await startFakeKiotViet();
    client = new KiotVietClient({
      tokenUrl: fake.tokenUrl,
      apiUrl: fake.apiUrl,
      sleep: async () => undefined,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fake.close();
  });

  it('pages customers in id order with removed ids, reading tolerant fields', async () => {
    fake.state.customers = [
      customer(1, { gender: true, birthDate: '1990-05-01T00:00:00', email: 'a@b.vn' }),
      customer(2, { gender: 'odd' }),
      { name: 'no id' } as unknown as FakeKvCustomer,
    ];
    fake.state.removedCustomerIds = [7];
    const since = new Date('2026-11-01T00:00:00.000Z');

    const page = await client.customers(creds, {
      currentItem: 0,
      pageSize: 500,
      lastModifiedFrom: since,
    });

    expect(page.total).toBe(3);
    expect(page.removedIds).toEqual([7]);
    expect(page.data).toEqual([
      {
        id: 1,
        code: 'KH1',
        name: 'Khách 1',
        contactNumber: '0912000001',
        email: 'a@b.vn',
        address: null,
        wardName: null,
        locationName: null,
        birthDate: '1990-05-01T00:00:00',
        gender: true,
      },
      expect.objectContaining({ id: 2, gender: null }),
    ]);
    expect(fake.apiRequests('/customers')[0]?.query).toMatchObject({
      currentItem: '0',
      pageSize: '100',
      includeRemoveIds: 'true',
      lastModifiedFrom: since.toISOString(),
      orderBy: 'id',
      orderDirection: 'Asc',
    });
  });

  it('reads one customer by id, null when KiotViet no longer has it', async () => {
    fake.state.customers = [customer(5)];
    expect((await client.customerById(creds, 5))?.name).toBe('Khách 5');
    expect(await client.customerById(creds, 6)).toBeNull();
  });

  it('looks customers up by phone', async () => {
    fake.state.customers = [customer(1), customer(2)];
    const found = await client.customersByPhone(creds, '0912000002');
    expect(found.map((c) => c.id)).toEqual([2]);
    expect(fake.apiRequests('/customers')[0]?.query).toMatchObject({
      contactNumber: '0912000002',
    });
  });

  it('creates a customer and answers its id', async () => {
    const body = { name: 'Lan', contactNumber: '0901234567', branchId: 1 };
    expect(await client.createCustomer(creds, body)).toEqual({ id: 1 });
    expect(fake.apiRequests('/customers')[0]).toMatchObject({ method: 'POST', body });
    expect(fake.state.customers).toHaveLength(1);
  });

  it('never sends a customer create twice: a 5xx is unavailable at once, a 4xx rejected', async () => {
    const body = { name: 'Lan', contactNumber: '0901234567', branchId: 1 };
    fake.state.customerCreateFailures = [500];
    await expect(client.createCustomer(creds, body)).rejects.toBeInstanceOf(
      KiotVietUnavailableError,
    );
    expect(fake.apiRequests('/customers')).toHaveLength(1);
    // The lost answer: KiotViet stored it anyway.
    expect(fake.state.customers).toHaveLength(1);

    await expect(
      client.createCustomer(creds, { ...body, contactNumber: '' }),
    ).rejects.toBeInstanceOf(KiotVietRejectedError);
  });
});
