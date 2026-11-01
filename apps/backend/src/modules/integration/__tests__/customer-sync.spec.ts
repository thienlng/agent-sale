import { createHmac } from 'node:crypto';

import { workspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import type { CatalogSyncFacade, OrderPushFacade } from '../../commerce/api/index.js';
import { ContactAlreadyLinkedError } from '../../crm/api/index.js';
import { CatalogImport } from '../application/catalog-import.js';
import { CatalogWriter } from '../application/catalog-writer.js';
import { ContactPusher, CONTACT_PUSH_SCAN_MS } from '../application/contact-push.js';
import { CustomerSync } from '../application/customer-sync.js';
import { OrderPusher } from '../application/order-push.js';
import type {
  ClaimedWebhookEvent,
  ConnectionRecord,
  JobRecord,
} from '../application/ports/integration-store.js';
import { SyncService } from '../application/sync.service.js';
import { SyncRunner } from '../application/sync-runner.js';
import { WebhookApplier } from '../application/webhook-apply.js';
import { WebhookSet } from '../application/webhook-set.js';
import {
  KiotVietAuthError,
  KiotVietPermissionError,
  KiotVietRejectedError,
  KiotVietUnavailableError,
} from '../domain/integration.errors.js';
import { FakeKiotVietGateway, kvCustomer } from './factories/fake-gateway.js';
import { JobStore } from './factories/job-store.js';
import { MemoryContacts } from './memory-contacts.js';

const ws = workspaceId('0190f5c2-0000-7000-8000-000000000001');
const CONN = '0190f5c2-0000-7000-8000-0000000000c1';
const box = SecretBox.insecureDevelopmentBox();
const WEBHOOK_SECRET = Buffer.from('webhook-secret-24-bytes!').toString('base64');
const CONNECTED_AT = new Date('2026-10-01T00:00:00.000Z');

function connection(over: Partial<ConnectionRecord> = {}): ConnectionRecord {
  return {
    id: CONN,
    workspaceId: ws,
    provider: 'kiotviet',
    status: 'connected',
    retailer: 'shopdemo',
    clientId: 'client-1',
    clientSecretSealed: box.seal('secret-1'),
    webhookToken: 'token',
    webhookSecretSealed: box.seal(WEBHOOK_SECRET),
    settings: { saleBranchIds: [1, 3], orderBranchId: 3, pushOrders: false, syncCustomers: true },
    version: 1,
    progress: null,
    // A full customer import finished before (the reconcile pass reads from this watermark).
    counts: { products: 12, lastCustomerSyncAt: '2026-11-01T02:00:00.000Z' },
    lastError: null,
    lastFullSyncAt: null,
    lastReconcileAt: new Date('2026-11-01T02:00:00.000Z'),
    connectedByUserId: null,
    createdAt: CONNECTED_AT,
    updatedAt: new Date(),
    ...over,
  };
}

let jobSeq = 0;
function job(over: Partial<JobRecord> = {}): JobRecord {
  jobSeq += 1;
  return {
    id: `job-${jobSeq}`,
    workspaceId: ws,
    connectionId: CONN,
    kind: 'customer_import',
    payload: {},
    cursor: null,
    attempts: 0,
    claimToken: `claim-${jobSeq}`,
    ...over,
  };
}

const noOrders = {
  claimOrdersForPush: async () => [],
  stalePendingOrders: async () => [],
  applyExternalOrderStatus: async () => 'unknown',
  releasePendingPushes: async () => 0,
} as unknown as OrderPushFacade;

let store: JobStore;
let gateway: FakeKiotVietGateway;
let contacts: MemoryContacts;
let catalog: CatalogSyncFacade;
let sync: SyncService;
let pusher: ContactPusher;
let webhooks: WebhookApplier;
let runner: SyncRunner;

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  store = new JobStore();
  gateway = new FakeKiotVietGateway();
  contacts = new MemoryContacts();
  catalog = {
    setExternalStock: vi.fn(async () => 0),
    removeExternalProducts: vi.fn(async () => 0),
    releaseExternalSource: vi.fn(async () => 0),
    countExternalProducts: vi.fn(async () => 12),
    linkedExternalIds: vi.fn(async () => ({ products: [], variants: [] })),
    archiveUnlinkedVariants: vi.fn(async () => 0),
  } as unknown as CatalogSyncFacade;
  const writer = new CatalogWriter(store, gateway, catalog);
  const customers = new CustomerSync(store, gateway, contacts);
  pusher = new ContactPusher(store, gateway, contacts);
  const orders = new OrderPusher(store, gateway, noOrders, catalog, pusher);
  sync = new SyncService(
    store,
    new CatalogImport(store, gateway, catalog, writer),
    box,
    writer,
    orders,
    new WebhookSet(gateway, box, { webhookBaseUrl: undefined }),
    customers,
    pusher,
  );
  webhooks = new WebhookApplier(store, gateway, catalog, writer, box, noOrders, customers);
  runner = new SyncRunner(store, sync, webhooks, orders, pusher);
  store.connections.push(connection());
});

const conn = () => store.connections[0]!;
const logOf = (code: string) => store.logs.filter((l) => l.code === code);
const phoneOf = (i: number) => `09120${String(i).padStart(5, '0')}`;
const e164Of = (i: number) => `+849120${String(i).padStart(5, '0')}`;

describe('customer_import job (full import)', () => {
  it('imports every page, links customers by phone, counts and logs', async () => {
    gateway.customerList = Array.from({ length: 150 }, (_, i) =>
      kvCustomer(i + 1, { contactNumber: phoneOf(i + 1) }),
    );
    const existing = contacts.add({ phoneE164: e164Of(3) });
    const j = job();
    await sync.runJob(j);

    expect(contacts.upserts).toHaveLength(150);
    expect(contacts.upserts[0]).toMatchObject({ externalId: '1', phone: phoneOf(1) });
    expect(existing.externalId).toBe('3');
    expect(contacts.contacts).toHaveLength(150);
    expect(store.cursors.map((c) => c['currentItem'])).toEqual([0, 100, 200]);
    expect(conn().counts).toEqual({
      products: 12,
      customers: 150,
      lastCustomerSyncAt: expect.any(String),
    });
    expect(logOf('customers_synced').map((l) => [l.level, l.params])).toEqual([
      ['info', { count: 150 }],
    ]);
    expect(store.completed).toEqual([j.id]);
  });

  it('resumes at the saved page', async () => {
    gateway.customerList = Array.from({ length: 150 }, (_, i) =>
      kvCustomer(i + 1, { contactNumber: phoneOf(i + 1) }),
    );
    await sync.runJob(job({ cursor: { currentItem: 100, startedAt: '2026-11-01T03:00:00.000Z' } }));
    expect(contacts.upserts.map((u) => u.externalId)).toEqual(
      Array.from({ length: 50 }, (_, i) => String(i + 101)),
    );
  });

  it('gives failed pushes another chance when an import starts, not when it resumes', async () => {
    contacts.add({ phoneE164: e164Of(9), push: 'failed', pushError: 'kiotviet_rejected' });
    await sync.runJob(job({ cursor: { currentItem: 0, startedAt: '2026-11-01T03:00:00.000Z' } }));
    expect(contacts.releaseFailedContactPushes).not.toHaveBeenCalled();
    await sync.runJob(job());
    expect(contacts.releaseFailedContactPushes).toHaveBeenCalledWith(ws, 'kiotviet');
    expect(contacts.contacts[0]!.push).toBeNull();
  });

  it('stops at a disconnect and releases what it linked after the release', async () => {
    gateway.customerList = Array.from({ length: 150 }, (_, i) => kvCustomer(i + 1));
    const read = gateway.customers.bind(gateway);
    gateway.customers = vi.fn(async (c, q) => {
      const page = await read(c, q);
      store.connections[0]!.status = 'disconnected';
      return page;
    });
    const j = job();
    await sync.runJob(j);

    expect(contacts.upserts).toHaveLength(0);
    expect(contacts.releaseExternalSource).toHaveBeenCalledWith(ws, 'kiotviet');
    expect(store.completed).toEqual([j.id]);
  });

  it('does nothing when the switch was turned off meanwhile', async () => {
    store.connections[0] = connection({
      settings: { ...connection().settings, syncCustomers: false },
    });
    gateway.customerList = [kvCustomer(1, { contactNumber: phoneOf(1) })];
    const j = job();
    await sync.runJob(j);
    expect(contacts.upserts).toEqual([]);
    expect(store.completed).toEqual([j.id]);
  });

  it('retries when KiotViet is down', async () => {
    gateway.fail.customers = new KiotVietUnavailableError();
    const j = job();
    await sync.runJob(j);
    expect(store.retried.map((r) => [r.id, r.error])).toEqual([[j.id, 'kiotviet_unavailable']]);
  });

  it('gives up without touching the connection, logging once until an import succeeds', async () => {
    gateway.fail.customers = new KiotVietUnavailableError();
    const j = job({ attempts: 3 });
    await sync.runJob(j);
    expect(store.failed).toEqual([{ id: j.id, error: 'kiotviet_unavailable' }]);
    expect(conn().status).toBe('connected');
    expect(conn().lastError).toBeNull();
    expect(logOf('customers_import_failed').map((l) => [l.level, l.params])).toEqual([
      ['warning', { reason: 'kiotviet_unavailable' }],
    ]);
    expect(logOf('kiotviet_unavailable')).toEqual([]);

    // Re-queued by the next reconcile and failing the same way: no second entry.
    await sync.runJob(job({ attempts: 3 }));
    expect(logOf('customers_import_failed')).toHaveLength(1);
    // Another reason is news.
    gateway.fail.customers = new Error('boom');
    await sync.runJob(job({ attempts: 3 }));
    expect(logOf('customers_import_failed').map((l) => l.params)).toEqual([
      { reason: 'kiotviet_unavailable' },
      { reason: 'sync_failed' },
    ]);
    // After a successful import the next failure is logged again.
    delete gateway.fail.customers;
    await sync.runJob(job());
    gateway.fail.customers = new Error('boom');
    await sync.runJob(job({ attempts: 3 }));
    expect(logOf('customers_import_failed')).toHaveLength(3);
    expect(conn().status).toBe('connected');
  });

  it('an auth error of the import still takes the connection path', async () => {
    gateway.fail.customers = new KiotVietAuthError();
    await sync.runJob(job());
    expect(conn().status).toBe('error');
    expect(conn().lastError?.code).toBe('auth_failed');
    expect(logOf('customers_import_failed')).toEqual([]);
  });

  it('unlinks the customers KiotViet reports removed, so they are never pushed back', async () => {
    const gone = contacts.add({ externalId: '77', phoneE164: e164Of(77) });
    gateway.customerList = [kvCustomer(5, { contactNumber: phoneOf(5) })];
    gateway.removedCustomerIds = [77];
    await sync.runJob(job());
    expect(contacts.unlinkExternalContacts).toHaveBeenCalledWith(ws, 'kiotviet', ['77']);
    expect(gone).toMatchObject({ externalId: null, push: 'detached' });

    await pusher.scan();
    expect(store.jobs.filter((x) => x.payload['contactId'] === gone.id)).toEqual([]);
  });

  it('pages by total, so a page of malformed records does not end the import', async () => {
    gateway.customerList = Array.from({ length: 150 }, (_, i) =>
      kvCustomer(i + 1, { contactNumber: phoneOf(i + 1) }),
    );
    const read = gateway.customers.bind(gateway);
    // The first page parses empty (every record malformed); KiotViet still says 150.
    gateway.customers = vi.fn(async (c, q) => {
      const page = await read(c, q);
      return q.currentItem === 0 ? { ...page, data: [] } : page;
    });
    await sync.runJob(job());
    expect(contacts.upserts.map((u) => u.externalId)).toEqual(
      Array.from({ length: 50 }, (_, i) => String(i + 101)),
    );
    expect(logOf('customers_synced')).toHaveLength(1);
  });

  it('stops when the switch is turned off during the import', async () => {
    gateway.customerList = Array.from({ length: 150 }, (_, i) => kvCustomer(i + 1));
    const read = gateway.customers.bind(gateway);
    gateway.customers = vi.fn(async (c, q) => {
      const page = await read(c, q);
      const now = store.connections[0]!;
      store.connections[0] = { ...now, settings: { ...now.settings, syncCustomers: false } };
      return page;
    });
    const j = job();
    await sync.runJob(j);
    expect(contacts.upserts).toEqual([]);
    expect(store.completed).toEqual([j.id]);
    expect(store.retried).toEqual([]);
    expect(logOf('customers_synced')).toEqual([]);
  });
});

describe('reconcile customer pass', () => {
  it('reads customers changed since the customer watermark and unlinks deleted ones', async () => {
    contacts.add({ externalId: '77' });
    gateway.customerList = [kvCustomer(5, { contactNumber: phoneOf(5) })];
    gateway.removedCustomerIds = [77];
    const calls = vi.spyOn(gateway, 'customers');
    await sync.runJob(job({ kind: 'reconcile' }));

    expect(calls.mock.calls[0]?.[1]).toMatchObject({
      currentItem: 0,
      lastModifiedFrom: new Date('2026-11-01T01:58:00.000Z'),
    });
    expect(contacts.upserts.map((u) => u.externalId)).toEqual(['5']);
    expect(contacts.unlinkExternalContacts).toHaveBeenCalledWith(ws, 'kiotviet', ['77']);
    expect(conn().counts).toMatchObject({ customers: 1 });
  });

  it('queues the full import instead when no customer import ever finished', async () => {
    // E.g. a connection whose switch was on before customer sync shipped.
    store.connections[0] = connection({ counts: { products: 12 } });
    const calls = vi.spyOn(gateway, 'customers');
    const j = job({ kind: 'reconcile' });
    await sync.runJob(j);
    expect(calls).not.toHaveBeenCalled();
    expect(store.completed).toContain(j.id);
    const imports = () =>
      store.jobs.filter((x) => x.kind === 'customer_import' && !x.payload['contactId']);
    expect(imports()).toHaveLength(1);
    await sync.runJob(job({ kind: 'reconcile' }));
    expect(imports()).toHaveLength(1);
  });

  it('stops when the switch is turned off during the pass, and the reconcile commits', async () => {
    gateway.customerList = Array.from({ length: 150 }, (_, i) => kvCustomer(i + 1));
    const read = gateway.customers.bind(gateway);
    gateway.customers = vi.fn(async (c, q) => {
      const page = await read(c, q);
      const now = store.connections[0]!;
      store.connections[0] = { ...now, settings: { ...now.settings, syncCustomers: false } };
      return page;
    });
    const before = conn().lastReconcileAt!;
    const j = job({ kind: 'reconcile' });
    await sync.runJob(j);
    expect(contacts.upserts).toEqual([]);
    expect(store.completed).toContain(j.id);
    expect(conn().status).toBe('connected');
    expect(conn().lastReconcileAt!.getTime()).toBeGreaterThan(before.getTime());
    expect(conn().counts.lastCustomerSyncAt).toBe('2026-11-01T02:00:00.000Z');
  });

  it('leaves customers alone while the switch is off', async () => {
    store.connections[0] = connection({
      settings: { ...connection().settings, syncCustomers: false },
    });
    const calls = vi.spyOn(gateway, 'customers');
    await sync.runJob(job({ kind: 'reconcile' }));
    expect(calls).not.toHaveBeenCalled();
  });
});

const sign = (body: string) => createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
const delivery = (body: object): ClaimedWebhookEvent => {
  const raw = JSON.stringify(body);
  return {
    id: 'evt-1',
    workspaceId: ws,
    connectionId: CONN,
    body: raw,
    signature: `sha256=${sign(raw)}`,
  };
};

describe('without the customer permission (403 on /customers)', () => {
  const forbidden = () => new KiotVietPermissionError(['customers']);
  const expectSwitchedOff = () => {
    expect(conn().settings.syncCustomers).toBe(false);
    expect(conn().status).toBe('connected');
    expect(conn().lastError).toBeNull();
    expect(contacts.releasePendingContactPushes).toHaveBeenCalledWith(ws, 'kiotviet');
    expect(logOf('customers_permission_missing').map((l) => l.level)).toEqual(['warning']);
    expect(logOf('auth_failed')).toEqual([]);
  };

  it('the import turns customer sync off and completes, logging once', async () => {
    gateway.fail.customers = forbidden();
    const j = job();
    await sync.runJob(j);
    expectSwitchedOff();
    expect(store.completed).toEqual([j.id]);
    expect(store.retried).toEqual([]);
    await sync.runJob(job());
    expect(logOf('customers_permission_missing')).toHaveLength(1);
  });

  it('the reconcile pass turns it off and the catalog reconcile still commits', async () => {
    gateway.fail.customers = forbidden();
    const before = conn().lastReconcileAt!;
    const j = job({ kind: 'reconcile' });
    await sync.runJob(j);
    expectSwitchedOff();
    expect(store.completed).toContain(j.id);
    expect(conn().lastReconcileAt!.getTime()).toBeGreaterThan(before.getTime());
  });

  it('a push turns it off, completes the job and leaves the customer unclaimed', async () => {
    const c = contacts.add({ phoneE164: e164Of(11), push: 'pending' });
    gateway.fail.customersByPhone = forbidden();
    const j = job({ payload: { contactId: c.id } });
    await sync.runJob(j);
    expectSwitchedOff();
    expect(c.push).toBeNull();
    expect(store.completed).toEqual([j.id]);
    expect(logOf('customer_push_failed')).toEqual([]);
  });
});

describe('a failing customer pass', () => {
  it('never fails the reconcile and keeps reading from the old watermark', async () => {
    gateway.fail.customers = new KiotVietUnavailableError();
    const j = job({ kind: 'reconcile' });
    await sync.runJob(j);
    expect(store.completed).toContain(j.id);
    expect(store.retried).toEqual([]);
    expect(conn().status).toBe('connected');
    // The watermark stays, although lastReconcileAt moved on.
    expect(conn().counts.lastCustomerSyncAt).toBe('2026-11-01T02:00:00.000Z');

    delete gateway.fail.customers;
    const calls = vi.spyOn(gateway, 'customers');
    await sync.runJob(job({ kind: 'reconcile' }));
    expect(calls.mock.calls[0]?.[1].lastModifiedFrom).toEqual(new Date('2026-11-01T01:58:00.000Z'));
    // Success moves the watermark to the start of that pass.
    expect(Date.parse(conn().counts.lastCustomerSyncAt!)).toBeGreaterThan(
      Date.parse('2026-11-01T02:00:00.000Z'),
    );
  });

  it('an auth error still takes the connection path', async () => {
    gateway.fail.customers = new KiotVietAuthError();
    await sync.runJob(job({ kind: 'reconcile' }));
    expect(conn().status).toBe('error');
    expect(conn().lastError?.code).toBe('auth_failed');
  });
});

describe('customer webhooks', () => {
  it('customer.update re-reads the customer (never the payload) and upserts it', async () => {
    gateway.customerList = [kvCustomer(5, { name: 'Tên thật', contactNumber: phoneOf(5) })];
    await webhooks.apply(
      delivery({
        Notifications: [{ Action: 'customer.update.123', Data: [{ Id: 5, Name: 'Payload' }] }],
      }),
    );
    expect(contacts.upserts).toEqual([
      expect.objectContaining({ externalId: '5', name: 'Tên thật' }),
    ]);
    expect(conn().counts).toMatchObject({ customers: 1 });
  });

  it('customer.update of a customer KiotViet no longer has unlinks it', async () => {
    contacts.add({ externalId: '6' });
    await webhooks.apply(
      delivery({ Notifications: [{ Action: 'customer.update', Data: [{ Id: 6 }] }] }),
    );
    expect(contacts.unlinkExternalContacts).toHaveBeenCalledWith(ws, 'kiotviet', ['6']);
  });

  it('customer.delete unlinks the customers, keeping them', async () => {
    const c = contacts.add({ externalId: '8' });
    await webhooks.apply(
      delivery({ Notifications: [{ Action: 'customer.delete', Data: [{ RemoveId: [8] }] }] }),
    );
    expect(c.externalId).toBeNull();
    expect(contacts.contacts).toHaveLength(1);
  });

  it('a customer imported then deleted in KiotViet is never created there again', async () => {
    gateway.customerList = [kvCustomer(8, { contactNumber: phoneOf(8) })];
    await sync.runJob(job());
    const c = contacts.byExternal('8')!;
    gateway.customerList = [];
    await webhooks.apply(
      delivery({ Notifications: [{ Action: 'customer.delete', Data: [{ RemoveId: [8] }] }] }),
    );
    expect(c).toMatchObject({ externalId: null, push: 'detached' });

    await pusher.scan();
    for (const queued of store.jobs.filter((x) => x.kind === 'customer_import'))
      await sync.runJob(job({ payload: queued.payload }));
    expect(gateway.calls.filter((x) => x.method === 'createCustomer')).toEqual([]);
    expect(c.externalId).toBeNull();
  });

  it('is ignored while the switch is off', async () => {
    store.connections[0] = connection({
      settings: { ...connection().settings, syncCustomers: false },
    });
    contacts.add({ externalId: '8' });
    await webhooks.apply(
      delivery({ Notifications: [{ Action: 'customer.delete', Data: [{ Id: 8 }] }] }),
    );
    expect(contacts.unlinkExternalContacts).not.toHaveBeenCalled();
    expect(logOf('webhook_unknown')).toEqual([]);
  });
});

describe('contact push', () => {
  const pushJobOf = (contactId: string, over: Partial<JobRecord> = {}) =>
    job({ payload: { contactId }, ...over });

  it('claims new customers every 30 s and queues one job each, never twice', async () => {
    const a = contacts.add({ phoneE164: e164Of(1) });
    const b = contacts.add({ phoneE164: e164Of(2) });
    contacts.add({ phoneE164: e164Of(3), createdAt: new Date('2026-09-01T00:00:00.000Z') });
    await runner.tick();
    expect(contacts.claimContactsForPush).toHaveBeenCalledWith(ws, 'kiotviet', CONNECTED_AT, 20);
    const queued = () =>
      store.jobs.filter((j) => j.kind === 'customer_import').map((j) => j.payload);
    expect(queued()).toEqual([{ contactId: a.id }, { contactId: b.id }]);

    contacts.stale = [a.id];
    await runner.tick();
    expect(contacts.claimContactsForPush).toHaveBeenCalledTimes(1);
    expect(CONTACT_PUSH_SCAN_MS).toBe(30_000);
    await pusher.scan();
    expect(queued()).toHaveLength(2);
  });

  it('with the switch off releases stale claims instead of claiming', async () => {
    store.connections[0] = connection({
      settings: { ...connection().settings, syncCustomers: false },
    });
    await pusher.scan();
    expect(contacts.claimContactsForPush).not.toHaveBeenCalled();
    expect(contacts.releasePendingContactPushes).toHaveBeenCalledWith(
      ws,
      'kiotviet',
      expect.any(Date),
    );
  });

  it('adopts the KiotViet customer with the same phone instead of creating one', async () => {
    const c = contacts.add({ phoneE164: e164Of(4), push: 'pending' });
    gateway.customerList = [
      kvCustomer(40, { contactNumber: '0912000099' }),
      kvCustomer(41, { contactNumber: `${phoneOf(4)}` }),
    ];
    const j = pushJobOf(c.id);
    await sync.runJob(j);

    expect(gateway.createdCustomers).toEqual([]);
    expect(c).toMatchObject({ externalId: '41', push: null });
    expect(conn().counts).toMatchObject({ customers: 1 });
    expect(store.completed).toEqual([j.id]);
  });

  it('creates the customer in the order branch when KiotViet has none', async () => {
    const c = contacts.add({ name: 'Lan', phoneE164: e164Of(5), push: 'pending' });
    await sync.runJob(pushJobOf(c.id));
    expect(gateway.createdCustomers).toEqual([
      { name: 'Lan', contactNumber: phoneOf(5), branchId: 3 },
    ]);
    expect(c.externalId).toBe(String(gateway.customerList[0]!.id));
  });

  it('after a lost answer the next attempt finds the customer by phone: no duplicate', async () => {
    const c = contacts.add({ phoneE164: e164Of(6), push: 'pending' });
    gateway.lostCustomerCreates = [new KiotVietUnavailableError()];
    const first = pushJobOf(c.id);
    await sync.runJob(first);
    expect(store.retried.map((r) => r.id)).toEqual([first.id]);
    expect(c.externalId).toBeNull();

    await sync.runJob(pushJobOf(c.id, { attempts: 1 }));
    expect(gateway.createdCustomers).toHaveLength(1);
    expect(c.externalId).toBe(String(gateway.customerList[0]!.id));
  });

  it('a customer linked meanwhile is done', async () => {
    const c = contacts.add({ phoneE164: e164Of(7), push: 'pending' });
    contacts.markContactPushed.mockRejectedValueOnce(new ContactAlreadyLinkedError());
    const j = pushJobOf(c.id);
    await sync.runJob(j);
    expect(store.completed).toEqual([j.id]);
    expect(contacts.markContactPushFailed).not.toHaveBeenCalled();
    expect(logOf('customer_push_failed')).toEqual([]);
  });

  it('a rejected customer fails at once and logs the reason only', async () => {
    const c = contacts.add({ phoneE164: e164Of(8), push: 'pending' });
    gateway.fail.createCustomer = new KiotVietRejectedError(400);
    await sync.runJob(pushJobOf(c.id));
    expect(c).toMatchObject({ push: 'failed', pushError: 'kiotviet_rejected' });
    expect(logOf('customer_push_failed').map((l) => [l.level, l.params])).toEqual([
      ['warning', { reason: 'kiotviet_rejected' }],
    ]);
  });

  it('gives up after the retries: the customer is marked failed, the connection untouched', async () => {
    const c = contacts.add({ phoneE164: e164Of(9), push: 'pending' });
    gateway.fail.customersByPhone = new KiotVietUnavailableError();
    const j = pushJobOf(c.id, { attempts: 3 });
    await sync.runJob(j);
    expect(store.failed).toEqual([{ id: j.id, error: 'kiotviet_unavailable' }]);
    expect(c).toMatchObject({ push: 'failed', pushError: 'kiotviet_unavailable' });
    expect(logOf('customer_push_failed').map((l) => l.params)).toEqual([
      { reason: 'kiotviet_unavailable' },
    ]);
    expect(conn().status).toBe('connected');
  });

  it('a customer no longer waiting (pushed, released, archived) completes with no call', async () => {
    const c = contacts.add({ phoneE164: e164Of(10) });
    const j = pushJobOf(c.id);
    await sync.runJob(j);
    expect(gateway.calls.filter((x) => x.method === 'customersByPhone')).toEqual([]);
    expect(store.completed).toEqual([j.id]);
    expect(c.push).toBeNull();
  });

  it('a pending customer that can no longer be pushed fails silently, so it is not re-queued', async () => {
    const c = contacts.add({ phoneE164: null, push: 'pending' });
    await sync.runJob(pushJobOf(c.id));
    expect(c).toMatchObject({ push: 'failed', pushError: 'not_pushable' });
    expect(logOf('customer_push_failed')).toEqual([]);
  });

  it('logs one entry per failure reason between scans', async () => {
    const a = contacts.add({ phoneE164: e164Of(12), push: 'pending' });
    const b = contacts.add({ phoneE164: e164Of(13), push: 'pending' });
    gateway.fail.createCustomer = new KiotVietRejectedError(400);
    await sync.runJob(pushJobOf(a.id));
    await sync.runJob(pushJobOf(b.id));
    expect([a.push, b.push]).toEqual(['failed', 'failed']);
    expect(logOf('customer_push_failed')).toHaveLength(1);

    await pusher.scan();
    const c = contacts.add({ phoneE164: e164Of(14), push: 'pending' });
    await sync.runJob(pushJobOf(c.id));
    expect(logOf('customer_push_failed')).toHaveLength(2);
  });
});
