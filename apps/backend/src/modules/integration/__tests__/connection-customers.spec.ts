import { workspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import type { CatalogSyncFacade, OrderPushFacade } from '../../commerce/api/index.js';
import { ConnectionService } from '../application/connection.service.js';
import { WebhookSet } from '../application/webhook-set.js';
import { FakeKiotVietGateway } from './factories/fake-gateway.js';
import { MemoryContacts } from './memory-contacts.js';
import { MemoryIntegrationStore } from './factories/memory-integration-store.js';

/** The customer switch on the connection: import, webhooks, push claims, disconnect (PR 3). */
const ws = workspaceId('0190f5c2-0000-7000-8000-000000000001');
const USER = '0190f5c2-0000-7000-8000-0000000000aa';
const creds = { retailer: 'shopdemo', clientId: 'client-1234', clientSecret: 'secret-xyz' };
const settings = { saleBranchIds: [1], orderBranchId: 1, pushOrders: false, syncCustomers: false };
const CUSTOMER_TYPES = ['customer.delete', 'customer.update'];

describe('ConnectionService and the customer switch', () => {
  let store: MemoryIntegrationStore;
  let gateway: FakeKiotVietGateway;
  let contacts: MemoryContacts;
  let service: ConnectionService;
  let statusAtRelease: string | undefined;
  const box = SecretBox.insecureDevelopmentBox();

  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    store = new MemoryIntegrationStore();
    gateway = new FakeKiotVietGateway();
    contacts = new MemoryContacts();
    contacts.releaseExternalSource.mockImplementation(async () => {
      statusAtRelease = store.connections[0]?.status;
      return 4;
    });
    service = new ConnectionService(
      store,
      gateway,
      { releaseExternalSource: vi.fn(async () => 0) } as unknown as CatalogSyncFacade,
      box,
      new WebhookSet(gateway, box, { webhookBaseUrl: 'https://hooks.rapiz.test' }),
      { releasePendingPushes: vi.fn(async () => 0) } as unknown as OrderPushFacade,
      contacts,
    );
  });

  afterEach(() => vi.restoreAllMocks());

  const customerHooks = () =>
    gateway.webhooks
      .map((h) => h.type)
      .filter((t) => t.startsWith('customer.'))
      .sort();
  const kinds = () => store.jobs.map((j) => [j.kind, j.payload]);

  it('connect with the switch on queues the customer import and registers customer webhooks', async () => {
    await service.connect(ws, USER, { ...creds, settings: { ...settings, syncCustomers: true } });
    expect(kinds()).toEqual([
      ['full_import', {}],
      ['customer_import', {}],
    ]);
    expect(customerHooks()).toEqual(CUSTOMER_TYPES);
  });

  it('connect with the switch off queues no customer import and no customer webhook', async () => {
    await service.connect(ws, USER, { ...creds, settings });
    expect(kinds()).toEqual([['full_import', {}]]);
    expect(customerHooks()).toEqual([]);
  });

  it('turning the switch on retries failed pushes, queues the import and adds the webhooks', async () => {
    const c = await service.connect(ws, USER, { ...creds, settings });
    contacts.add({ phoneE164: '+84912000001', push: 'failed' });
    await service.update(ws, {
      version: c.version,
      settings: { ...settings, syncCustomers: true },
    });

    expect(contacts.releaseFailedContactPushes).toHaveBeenCalledWith(ws, 'kiotviet');
    expect(contacts.contacts[0]!.push).toBeNull();
    expect(kinds()).toContainEqual(['customer_import', {}]);
    expect(customerHooks()).toEqual(CUSTOMER_TYPES);
  });

  it('turning it off releases pending pushes and removes the customer webhooks', async () => {
    const c = await service.connect(ws, USER, {
      ...creds,
      settings: { ...settings, syncCustomers: true },
    });
    await service.update(ws, { version: c.version, settings });

    expect(contacts.releasePendingContactPushes).toHaveBeenCalledWith(ws, 'kiotviet');
    expect(customerHooks()).toEqual([]);
    expect(store.jobs.filter((j) => j.kind === 'customer_import')).toHaveLength(1);
  });

  it('a save that leaves the switch on queues nothing new', async () => {
    const c = await service.connect(ws, USER, {
      ...creds,
      settings: { ...settings, syncCustomers: true },
    });
    await service.update(ws, {
      version: c.version,
      settings: { ...settings, syncCustomers: true, pushOrders: true },
    });
    expect(contacts.releaseFailedContactPushes).not.toHaveBeenCalled();
    expect(contacts.releasePendingContactPushes).not.toHaveBeenCalled();
    expect(store.jobs.filter((j) => j.kind === 'customer_import')).toHaveLength(1);
  });

  it('disconnect unlinks the customers after the status write, keeping them', async () => {
    await service.connect(ws, USER, { ...creds, settings: { ...settings, syncCustomers: true } });
    await service.disconnect(ws);
    expect(contacts.releaseExternalSource).toHaveBeenCalledWith(ws, 'kiotviet');
    expect(statusAtRelease).toBe('disconnected');
  });
});
