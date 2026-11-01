import { createHmac } from 'node:crypto';

import { workspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import {
  type CatalogSyncFacade,
  OrderAlreadyPushedError,
  type OrderPushFacade,
  type PushableOrder,
} from '../../commerce/api/index.js';
import { CatalogImport } from '../application/catalog-import.js';
import { CatalogWriter } from '../application/catalog-writer.js';
import { ContactPusher } from '../application/contact-push.js';
import { CustomerSync } from '../application/customer-sync.js';
import { OrderPusher, STALE_PENDING_MS } from '../application/order-push.js';
import type { ConnectionRecord, JobRecord } from '../application/ports/integration-store.js';
import { SyncService } from '../application/sync.service.js';
import { SyncRunner } from '../application/sync-runner.js';
import { WebhookApplier } from '../application/webhook-apply.js';
import { WebhookSet } from '../application/webhook-set.js';
import {
  KiotVietAuthError,
  KiotVietRejectedError,
  KiotVietUnavailableError,
} from '../domain/integration.errors.js';
import { KV_ORDER_STATUS, kiotVietOrderTotal } from '../domain/kiotviet-order.js';
import { FakeKiotVietGateway, kvCustomer } from './factories/fake-gateway.js';
import { JobStore } from './factories/job-store.js';
import { MemoryContacts } from './memory-contacts.js';

const ws = workspaceId('0190f5c2-0000-7000-8000-000000000001');
const CONN = '0190f5c2-0000-7000-8000-0000000000c1';
const ORDER = '0190f5c2-0000-7000-8000-0000000000a1';
const box = SecretBox.insecureDevelopmentBox();
const WEBHOOK_SECRET = Buffer.from('webhook-secret-24-bytes!').toString('base64');

interface MemOrder {
  payload: PushableOrder;
  state: 'pending' | 'pushed' | 'failed' | null;
  cancelled: boolean;
  externalId: string | null;
  externalStatus: string | null;
  error: { code: string; params?: Record<string, string | number> } | null;
  problem?: { reason: 'unlinked_product'; name: string } | { reason: 'empty' };
}

/** In-memory OrderPushFacade with commerce's state rules. */
class MemoryOrders implements OrderPushFacade {
  orders = new Map<string, MemOrder>();
  claims: Array<{ since: Date; limit: number }> = [];
  /** What `stalePendingOrders` answers. */
  stale: string[] = [];

  add(id: string, over: Partial<MemOrder> = {}): MemOrder {
    const o: MemOrder = {
      payload: pushable(id),
      state: null,
      cancelled: false,
      externalId: null,
      externalStatus: null,
      error: null,
      ...over,
    };
    this.orders.set(id, o);
    return o;
  }

  claimOrdersForPush = vi.fn(async (_ws: unknown, _s: unknown, since: Date, limit: number) => {
    this.claims.push({ since, limit });
    const ids = [...this.orders.entries()]
      .filter(([, o]) => o.state === null && !o.cancelled)
      .slice(0, limit)
      .map(([id]) => id);
    ids.forEach((id) => (this.orders.get(id)!.state = 'pending'));
    return ids;
  });

  pushableOrder = vi.fn(async (_ws: unknown, id: string) => {
    const o = this.orders.get(id);
    if (!o || o.state !== 'pending') return null;
    if (o.problem) return { problem: o.problem, code: o.payload.code };
    return { order: structuredClone(o.payload) };
  });

  markOrderPushed = vi.fn(
    async (
      _ws: unknown,
      id: string,
      ref: { externalId: string; externalCode: string; externalStatus: string },
    ) => {
      const o = this.orders.get(id)!;
      if (o.state === 'pushed') {
        if (o.externalId === ref.externalId) return { cancelled: o.cancelled };
        throw new OrderAlreadyPushedError('DHOLD');
      }
      Object.assign(o, {
        state: 'pushed',
        externalId: ref.externalId,
        externalStatus: ref.externalStatus,
        error: null,
      });
      return { cancelled: o.cancelled };
    },
  );

  markOrderPushFailed = vi.fn(
    async (
      _ws: unknown,
      id: string,
      error: { code: string; params?: Record<string, string | number> },
    ) => {
      const o = this.orders.get(id)!;
      if (o.state !== 'pending') return;
      o.state = 'failed';
      o.error = error;
    },
  );

  /** Order creation times (default: after any connection), for the `since` check. */
  createdAt = new Map<string, Date>();

  requeueOrderPush = vi.fn(async (_ws: unknown, id: string, since: Date) => {
    const o = this.orders.get(id)!;
    if (o.state !== 'failed') throw new Error('not failed');
    if ((this.createdAt.get(id) ?? new Date()) < since) return 'before_since' as const;
    Object.assign(o, { state: null, error: null });
    return 'requeued' as const;
  });

  stalePendingOrders = vi.fn(async () => [...this.stale]);

  releasePendingPushes = vi.fn(async (_ws: unknown, _s: unknown, _olderThan?: Date) => 0);

  applyExternalOrderStatus = vi.fn(
    async (
      _ws: unknown,
      _s: unknown,
      externalId: string,
      status: { code: string; cancelled: boolean },
    ) => {
      const o = [...this.orders.values()].find((x) => x.externalId === externalId);
      if (!o) return 'unknown' as const;
      o.externalStatus = status.code;
      if (status.cancelled && !o.cancelled) {
        o.cancelled = true;
        return 'cancelled' as const;
      }
      return 'updated' as const;
    },
  );

  pushedOrderCount = vi.fn(
    async () => [...this.orders.values()].filter((o) => o.state === 'pushed').length,
  );
}

function pushable(id: string): PushableOrder {
  return {
    id,
    code: 'DH0012',
    placedAt: new Date('2026-11-01T03:00:00.000Z'),
    note: '',
    lines: [
      {
        externalVariantId: '501',
        sku: 'AO-S',
        name: 'Áo – S',
        qty: 2,
        unitPrice: 100_000,
        lineDiscount: 0,
      },
    ],
    discount: 0,
    shippingFee: 20_000,
    total: 225_000,
    customer: { name: 'Lan', phone: '0901234567' },
    recipient: { name: 'Lan', phone: '0901234567', address: '1 Lê Lợi' },
  };
}

function connection(over: Partial<ConnectionRecord> = {}): ConnectionRecord {
  const now = new Date();
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
    settings: { saleBranchIds: [1, 3], orderBranchId: 3, pushOrders: true, syncCustomers: false },
    version: 1,
    progress: null,
    counts: { products: 12 },
    lastError: null,
    lastFullSyncAt: null,
    lastReconcileAt: new Date(),
    connectedByUserId: null,
    createdAt: new Date('2026-10-01T00:00:00.000Z'),
    updatedAt: now,
    ...over,
  };
}

let jobSeq = 0;
function pushJob(over: Partial<JobRecord> = {}): JobRecord {
  jobSeq += 1;
  return {
    id: `job-${jobSeq}`,
    workspaceId: ws,
    connectionId: CONN,
    kind: 'push_order',
    payload: { orderId: ORDER, firstAttemptAt: '2026-11-01T03:00:10.000Z' },
    cursor: null,
    attempts: 0,
    claimToken: `claim-${jobSeq}`,
    ...over,
  };
}

let store: JobStore;
let gateway: FakeKiotVietGateway;
let orders: MemoryOrders;
let sync: SyncService;
let contacts: MemoryContacts;
let customers: CustomerSync;
let contactPusher: ContactPusher;
let pusher: OrderPusher;
let webhooks: WebhookApplier;
let catalog: CatalogSyncFacade;

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  store = new JobStore();
  gateway = new FakeKiotVietGateway();
  orders = new MemoryOrders();
  catalog = {
    setExternalStock: vi.fn(async () => 0),
    removeExternalProducts: vi.fn(async () => 0),
    releaseExternalSource: vi.fn(async () => 0),
    countExternalProducts: vi.fn(async () => 0),
    linkedExternalIds: vi.fn(async () => ({ products: [], variants: [] })),
    archiveUnlinkedVariants: vi.fn(async () => 0),
  } as unknown as CatalogSyncFacade;
  const writer = new CatalogWriter(store, gateway, catalog);
  contacts = new MemoryContacts();
  customers = new CustomerSync(store, gateway, contacts);
  contactPusher = new ContactPusher(store, gateway, contacts);
  pusher = new OrderPusher(store, gateway, orders, catalog, contactPusher);
  sync = new SyncService(
    store,
    new CatalogImport(store, gateway, catalog, writer),
    box,
    writer,
    pusher,
    new WebhookSet(gateway, box, { webhookBaseUrl: 'https://hooks.rapiz.test' }),
    customers,
    contactPusher,
  );
  webhooks = new WebhookApplier(store, gateway, catalog, writer, box, orders, customers);
  store.connections.push(connection());
});

const conn = () => store.connections[0]!;
const order = () => orders.orders.get(ORDER)!;
const logOf = (code: string) => store.logs.filter((l) => l.code === code);

describe('push_order job', () => {
  it('creates the KiotViet order, records it, logs and counts it', async () => {
    orders.add(ORDER, { state: 'pending' });
    const j = pushJob();
    await sync.runJob(j);

    expect(gateway.orders).toHaveLength(1);
    const sent = gateway.orders[0]!.body;
    expect(sent.branchId).toBe(3);
    expect(sent.description).toBe('Rapiz DH0012');
    expect(kiotVietOrderTotal(sent)).toBe(225_000);
    expect(order()).toMatchObject({
      state: 'pushed',
      externalId: String(gateway.orders[0]!.id),
      externalStatus: 'draft',
    });
    expect(logOf('order_pushed').map((l) => [l.level, l.params])).toEqual([
      ['info', { code: 'DH0012' }],
    ]);
    expect(conn().counts).toEqual({ products: 12, ordersPushed: 1 });
    expect(store.completed).toEqual([j.id]);
  });

  describe('stock right after the push', () => {
    // KiotViet product 501 (the line's variant): 10 on hand in branch 3, 1 already reserved; 4 in
    // branch 1 (a sale branch too) and 50 in branch 9 (not a sale branch).
    beforeEach(() => {
      gateway.productsById = [
        {
          id: 501,
          code: 'AO-S',
          name: 'Áo',
          inventories: [
            { branchId: 3, onHand: 10, reserved: 1 },
            { branchId: 1, onHand: 4, reserved: 0 },
            { branchId: 9, onHand: 50, reserved: 0 },
          ],
        },
      ];
    });

    it("sets the lines' stock to KiotViet's available, its new reservation included", async () => {
      orders.add(ORDER, { state: 'pending' });
      const j = pushJob();
      await sync.runJob(j);

      // 10 − (1 + 2 for this order) + 4: the hold Rapiz released is now KiotViet's reservation.
      expect(catalog.setExternalStock).toHaveBeenCalledWith(ws, 'kiotviet', [
        { externalVariantId: '501', available: 11 },
      ]);
      expect(store.completed).toEqual([j.id]);
    });

    it('also after adopting the order an earlier attempt stored', async () => {
      orders.add(ORDER, { state: 'pending' });
      gateway.lostCreates = [new KiotVietUnavailableError()];
      await sync.runJob(pushJob());
      expect(catalog.setExternalStock).not.toHaveBeenCalled();

      await sync.runJob(pushJob({ cursor: { ambiguous: true, branchId: 3 }, attempts: 1 }));
      expect(order().state).toBe('pushed');
      expect(catalog.setExternalStock).toHaveBeenCalledWith(ws, 'kiotviet', [
        { externalVariantId: '501', available: 11 },
      ]);
    });

    it('a failed refresh only logs: the order stays pushed and the job completes', async () => {
      orders.add(ORDER, { state: 'pending' });
      gateway.fail.productById = new KiotVietUnavailableError();
      const j = pushJob();
      await sync.runJob(j);

      expect(order().state).toBe('pushed');
      expect(catalog.setExternalStock).not.toHaveBeenCalled();
      expect(store.retried).toEqual([]);
      expect(store.completed).toEqual([j.id]);
    });
  });

  it('completes without work when the order is no longer pending', async () => {
    const j = pushJob();
    await sync.runJob(j);
    expect(gateway.orders).toHaveLength(0);
    expect(store.completed).toEqual([j.id]);
  });

  it('marks an order with an unlinked product failed, without calling KiotViet', async () => {
    orders.add(ORDER, { state: 'pending', problem: { reason: 'unlinked_product', name: 'Mũ' } });
    const j = pushJob();
    await sync.runJob(j);

    expect(gateway.calls.filter((c) => c.method === 'createOrder')).toHaveLength(0);
    expect(order()).toMatchObject({
      state: 'failed',
      error: { code: 'unlinked_product', params: { name: 'Mũ' } },
    });
    expect(logOf('order_push_failed').map((l) => [l.level, l.params])).toEqual([
      ['warning', { code: 'DH0012', reason: 'unlinked_product' }],
    ]);
    expect(store.completed).toEqual([j.id]);
  });

  it('an ambiguous failure retries by adopting the order KiotViet stored (no duplicate)', async () => {
    orders.add(ORDER, { state: 'pending' });
    gateway.lostCreates = [new KiotVietUnavailableError()];
    // Another Rapiz order with a code that starts the same must not be adopted.
    gateway.orders.push({
      id: 6999,
      code: 'DH6999',
      status: 1,
      description: 'Rapiz DH00123',
      branchId: 3,
      body: structuredClone(gateway.orders[0]?.body) as never,
    });
    const first = pushJob();
    await sync.runJob(first);

    expect(store.retried).toEqual([
      { id: first.id, runAfter: expect.any(Date), error: 'kiotviet_unavailable' },
    ]);
    expect(store.cursors.at(-1)).toEqual({ ambiguous: true, branchId: 3 });
    expect(order().state).toBe('pending');

    await sync.runJob(pushJob({ cursor: { ambiguous: true, branchId: 3 }, attempts: 1 }));
    expect(gateway.calls.filter((c) => c.method === 'createOrder')).toHaveLength(1);
    expect(gateway.orders).toHaveLength(2);
    expect(order()).toMatchObject({ state: 'pushed', externalId: String(gateway.orders[1]!.id) });
    expect(logOf('order_pushed')).toHaveLength(1);
  });

  it('after an ambiguous failure with no stored order, creates it on the retry', async () => {
    orders.add(ORDER, { state: 'pending' });
    await sync.runJob(pushJob({ cursor: { ambiguous: true }, attempts: 1 }));
    expect(gateway.calls.map((c) => c.method)).toEqual(['recentOrders', 'createOrder']);
    expect(order().state).toBe('pushed');
  });

  it('a 4xx from KiotViet fails the order at once, without a retry', async () => {
    orders.add(ORDER, { state: 'pending' });
    gateway.fail.createOrder = new KiotVietRejectedError(400);
    const j = pushJob();
    await sync.runJob(j);

    expect(order()).toMatchObject({ state: 'failed', error: { code: 'kiotviet_rejected' } });
    expect(store.retried).toEqual([]);
    expect(store.completed).toEqual([j.id]);
    expect(logOf('order_push_failed')[0]?.params).toEqual({
      code: 'DH0012',
      reason: 'kiotviet_rejected',
    });
  });

  it('after the last retry the order fails; the connection stays connected', async () => {
    orders.add(ORDER, { state: 'pending' });
    gateway.fail.createOrder = new KiotVietUnavailableError();
    const j = pushJob({ attempts: 3, cursor: { ambiguous: true } });
    await sync.runJob(j);

    expect(store.failed).toEqual([{ id: j.id, error: 'kiotviet_unavailable' }]);
    expect(order()).toMatchObject({ state: 'failed', error: { code: 'kiotviet_unavailable' } });
    expect(conn().status).toBe('connected');
    expect(logOf('order_push_failed')[0]?.params).toEqual({
      code: 'DH0012',
      reason: 'kiotviet_unavailable',
    });
  });

  it('an auth error puts the connection in error and fails the order', async () => {
    orders.add(ORDER, { state: 'pending' });
    gateway.fail.createOrder = new KiotVietAuthError();
    const j = pushJob();
    await sync.runJob(j);

    expect(store.failed).toEqual([{ id: j.id, error: 'auth_failed' }]);
    expect(conn()).toMatchObject({ status: 'error', lastError: { code: 'auth_failed' } });
    expect(order()).toMatchObject({ state: 'failed', error: { code: 'auth_failed' } });
    expect(logOf('order_push_failed')[0]?.params).toEqual({
      code: 'DH0012',
      reason: 'auth_failed',
    });
  });

  it('an order already pushed elsewhere logs a duplicate and completes', async () => {
    orders.add(ORDER, { state: 'pending' });
    orders.markOrderPushed.mockRejectedValueOnce(new OrderAlreadyPushedError('DHKV1'));
    const j = pushJob();
    await sync.runJob(j);

    expect(store.retried).toEqual([]);
    expect(store.completed).toEqual([j.id]);
    expect(logOf('order_push_failed')).toEqual([]);
    expect(logOf('order_push_duplicate').map((l) => [l.level, l.params])).toEqual([
      ['warning', { code: 'DH0012' }],
    ]);
  });

  it('an order cancelled meanwhile is recorded and flagged for staff', async () => {
    orders.add(ORDER, { state: 'pending' });
    orders.pushableOrder.mockImplementationOnce(async () => {
      const result = { order: structuredClone(order().payload) };
      order().cancelled = true;
      return result;
    });
    await sync.runJob(pushJob());

    expect(order().state).toBe('pushed');
    expect(logOf('order_pushed')).toHaveLength(0);
    expect(logOf('order_pushed_cancelled').map((l) => [l.level, l.params])).toEqual([
      ['warning', { code: 'DH0012' }],
    ]);
  });

  it('never pushes for a connection whose connect failed or that is gone; the order fails', async () => {
    conn().lastError = { code: 'connect_failed', at: new Date().toISOString() };
    orders.add(ORDER, { state: 'pending' });
    await sync.runJob(pushJob());
    expect(gateway.orders).toHaveLength(0);
    expect(order()).toMatchObject({ state: 'failed', error: { code: 'not_connected' } });
    expect(logOf('order_push_failed')[0]?.params).toEqual({
      code: 'DH0012',
      reason: 'not_connected',
    });

    conn().lastError = null;
    conn().status = 'disconnected';
    orders.add(ORDER, { state: 'pending' });
    await sync.runJob(pushJob());
    expect(order()).toMatchObject({ state: 'failed', error: { code: 'not_connected' } });
  });
});

describe('the KiotViet customer of a pushed order', () => {
  const customersOn = () => {
    store.connections[0] = connection({
      settings: { ...connection().settings, syncCustomers: true },
    });
  };

  it('names the KiotViet customer with the buyer phone instead of the inline customer', async () => {
    customersOn();
    gateway.customerList = [kvCustomer(9001, { contactNumber: '0901234567' })];
    orders.add(ORDER, { state: 'pending' });
    await sync.runJob(pushJob());

    const sent = gateway.orders[0]!.body;
    expect(sent.customerId).toBe(9001);
    expect(sent.customer).toBeUndefined();
    expect(gateway.createdCustomers).toEqual([]);
    expect(order().state).toBe('pushed');
  });

  it('creates the customer in the order branch when KiotViet has none', async () => {
    customersOn();
    orders.add(ORDER, { state: 'pending' });
    await sync.runJob(pushJob());

    expect(gateway.createdCustomers).toEqual([
      { name: 'Lan', contactNumber: '0901234567', branchId: 3 },
    ]);
    expect(gateway.orders[0]!.body.customerId).toBe(gateway.customerList[0]!.id);
  });

  it('falls back to the inline customer when the customer cannot be resolved', async () => {
    customersOn();
    gateway.fail.customersByPhone = new KiotVietUnavailableError();
    orders.add(ORDER, { state: 'pending' });
    await sync.runJob(pushJob());

    const sent = gateway.orders[0]!.body;
    expect(sent.customerId).toBeUndefined();
    expect(sent.customer).toEqual({ name: 'Lan', contactNumber: '0901234567' });
    expect(order().state).toBe('pushed');
  });

  it('keeps the inline customer while customer sync is off', async () => {
    gateway.customerList = [kvCustomer(9001, { contactNumber: '0901234567' })];
    orders.add(ORDER, { state: 'pending' });
    await sync.runJob(pushJob());

    expect(gateway.orders[0]!.body.customerId).toBeUndefined();
    expect(gateway.calls.filter((c) => c.method === 'customersByPhone')).toEqual([]);
  });
});

describe('push scan', () => {
  it('claims eligible orders every 15 s and queues one job per order', async () => {
    const runner = new SyncRunner(store, sync, webhooks, pusher, contactPusher);
    orders.add(ORDER);
    orders.add('0190f5c2-0000-7000-8000-0000000000a2');
    store.connections.push(
      connection({ id: 'other', status: 'error', workspaceId: ws }),
      connection({
        id: 'off',
        settings: { saleBranchIds: [1], orderBranchId: 1, pushOrders: false, syncCustomers: false },
      }),
    );

    await runner.tick();
    await runner.tick();

    const pushJobs = store.jobs.filter((j) => j.kind === 'push_order');
    expect(pushJobs.map((j) => j.payload['orderId'])).toEqual([
      ORDER,
      '0190f5c2-0000-7000-8000-0000000000a2',
    ]);
    expect(pushJobs.every((j) => j.connectionId === CONN)).toBe(true);
    expect(typeof pushJobs[0]?.payload['firstAttemptAt']).toBe('string');
    // One scan per 15 s, with the connection's creation as the earliest order.
    expect(orders.claims).toEqual([{ since: conn().createdAt, limit: 20 }]);
  });
});

describe('push scan with push off', () => {
  it('releases stale claims of a connected connection with push off, and queues nothing', async () => {
    conn().settings.pushOrders = false;
    orders.add(ORDER, { state: 'pending' });
    orders.stale = [ORDER];
    const before = Date.now();
    await pusher.scan();

    expect(orders.claimOrdersForPush).not.toHaveBeenCalled();
    expect(orders.stalePendingOrders).not.toHaveBeenCalled();
    expect(store.jobs.filter((j) => j.kind === 'push_order')).toEqual([]);
    expect(orders.releasePendingPushes).toHaveBeenCalledWith(ws, 'kiotviet', expect.any(Date));
    const olderThan = orders.releasePendingPushes.mock.calls[0]![2]!;
    expect(before - olderThan.getTime()).toBeGreaterThanOrEqual(STALE_PENDING_MS - 50);
    expect(before - olderThan.getTime()).toBeLessThanOrEqual(STALE_PENDING_MS + 50);
  });

  it('leaves the claims of a pushing connection to the re-queue', async () => {
    orders.add(ORDER, { state: 'pending' });
    await pusher.scan();
    expect(orders.releasePendingPushes).not.toHaveBeenCalled();
    expect(orders.stalePendingOrders).toHaveBeenCalled();
  });

  it('touches nothing of a connection in error', async () => {
    conn().settings.pushOrders = false;
    conn().status = 'error';
    await pusher.scan();
    expect(orders.releasePendingPushes).not.toHaveBeenCalled();
  });
});

describe('order.update webhook', () => {
  const deliver = async (body: object) => {
    const raw = JSON.stringify(body);
    const signature = `sha256=${createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex')}`;
    await webhooks.apply({ id: 'e1', workspaceId: ws, connectionId: CONN, body: raw, signature });
  };

  it('re-reads the order (not the payload) and applies its status; unknown ids are ignored', async () => {
    orders.add(ORDER, { state: 'pushed', externalId: '7001' });
    gateway.orders.push(
      {
        id: 7001,
        code: 'DH7001',
        status: KV_ORDER_STATUS.cancelled,
        description: 'Rapiz DH0012',
        branchId: 3,
        body: {} as never,
      },
      {
        id: 7002,
        code: 'DH7002',
        status: KV_ORDER_STATUS.completed,
        description: null,
        branchId: 3,
        body: {} as never,
      },
    );
    await deliver({
      Id: 'd1',
      Notifications: [
        {
          Action: 'order.update.123',
          Data: [{ Id: 7001, Status: KV_ORDER_STATUS.completed }, { Id: 7002 }, { Id: 7999 }],
        },
      ],
    });

    expect(order()).toMatchObject({ cancelled: true, externalStatus: 'cancelled' });
    expect(orders.applyExternalOrderStatus).toHaveBeenCalledTimes(2);
    expect(logOf('webhook_unknown')).toHaveLength(0);
  });
});

describe('reconcile', () => {
  const url = 'https://hooks.rapiz.test/webhooks/kiotviet/token';
  const hook = (id: number, type: string) => ({
    id,
    type,
    url,
    secretBase64: WEBHOOK_SECRET,
    credentials: { retailer: 'shopdemo', clientId: 'client-1', clientSecret: 'secret-1' },
  });

  it('ensures the webhook set once per run with the background gateway', async () => {
    gateway.webhooks = [hook(1, 'product.update'), hook(2, 'product.delete')];
    conn().settings.webhookIds = [1, 2];
    const version = conn().version;
    await sync.runJob(pushJob({ kind: 'reconcile', payload: {} }));

    expect(gateway.webhooks.map((h) => h.type)).toEqual([
      'product.update',
      'product.delete',
      'stock.update',
      'order.update',
    ]);
    expect(gateway.calls.filter((c) => c.method === 'listWebhooks')).toEqual([
      expect.objectContaining({ interactive: false }),
    ]);
    expect(conn().settings.webhookIds).toEqual(gateway.webhooks.map((h) => h.id));
    expect(conn().version).toBe(version + 1);

    // Nothing to change: no write.
    await sync.runJob(pushJob({ kind: 'reconcile', payload: {} }));
    expect(conn().version).toBe(version + 1);
  });

  it('removes order.update once push is off, and a failure does not fail the reconcile', async () => {
    conn().settings.pushOrders = false;
    gateway.webhooks = [
      hook(1, 'product.update'),
      hook(2, 'product.delete'),
      hook(3, 'stock.update'),
      hook(4, 'order.update'),
    ];
    await sync.runJob(pushJob({ kind: 'reconcile', payload: {} }));
    expect(gateway.webhooks.map((h) => h.id)).toEqual([1, 2, 3]);
    expect(conn().settings.webhookIds).toEqual([1, 2, 3]);

    gateway.fail.listWebhooks = new KiotVietUnavailableError();
    const j = pushJob({ kind: 'reconcile', payload: {} });
    await sync.runJob(j);
    expect(store.completed).toContain(j.id);
    expect(conn().status).toBe('connected');
  });
});

describe('"Thử lại"', () => {
  const failedOrder = () => orders.add(ORDER, { state: 'failed', error: { code: 'x' } });

  it('requeues a failed push of an order created since the connection', async () => {
    failedOrder();
    await pusher.retry(ws, ORDER);
    expect(order().state).toBeNull();
    expect(orders.requeueOrderPush).toHaveBeenCalledWith(ws, ORDER, conn().createdAt);
  });

  it.each([
    ['no live connection', () => (conn().status = 'disconnected')],
    ['push off', () => (conn().settings.pushOrders = false)],
    ['a connection in error', () => (conn().status = 'error')],
    [
      'a connect that failed',
      () => (conn().lastError = { code: 'connect_failed', at: new Date().toISOString() }),
    ],
  ])('answers 409 not_pushing with %s, leaving the order failed', async (_name, arrange) => {
    failedOrder();
    arrange();
    await expect(pusher.retry(ws, ORDER)).rejects.toMatchObject({
      code: 'CONFLICT',
      details: { reason: 'not_pushing' },
    });
    expect(order().state).toBe('failed');
  });

  it('answers 409 not_pushing for an order created before the connection', async () => {
    failedOrder();
    orders.createdAt.set(ORDER, new Date('2026-09-01T00:00:00.000Z'));
    await expect(pusher.retry(ws, ORDER)).rejects.toMatchObject({
      details: { reason: 'not_pushing' },
    });
    expect(order().state).toBe('failed');
  });
});

describe('push retries across jobs', () => {
  const createCalls = () => gateway.calls.filter((c) => c.method === 'createOrder');

  it('"Thử lại" after an ambiguous last attempt looks before creating: one POST in total', async () => {
    orders.add(ORDER);
    await pusher.scan();
    const first = store.jobs.at(-1)!;
    const firstAttemptAt = first.payload['firstAttemptAt'];
    // The owner moves the order branch after the attempt: the lookup still searches branch 3.
    gateway.lostCreates = [new KiotVietUnavailableError()];
    await sync.runJob(store.claimed(first.id, { attempts: 3 }));
    expect(order()).toMatchObject({ state: 'failed', error: { code: 'kiotviet_unavailable' } });
    conn().settings.orderBranchId = 1;

    await pusher.retry(ws, ORDER);
    await pusher.scan();
    const again = store.jobs.at(-1)!;
    expect(again.id).not.toBe(first.id);
    expect(again.payload).toEqual({ orderId: ORDER, firstAttemptAt, ambiguous: true, branchId: 3 });

    await sync.runJob(store.claimed(again.id));
    expect(createCalls()).toHaveLength(1);
    expect(gateway.orders).toHaveLength(1);
    expect(gateway.calls.find((c) => c.method === 'recentOrders')).toBeDefined();
    expect(order()).toMatchObject({ state: 'pushed', externalId: String(gateway.orders[0]!.id) });
  });

  it('re-queues a stale pending order once, never while its job is open', async () => {
    orders.add(ORDER, { state: 'pending' });
    orders.stale = [ORDER];
    await pusher.scan();
    await pusher.scan();
    const jobs = store.jobs.filter((j) => j.kind === 'push_order');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.payload).toMatchObject({ orderId: ORDER });
    expect(orders.stalePendingOrders).toHaveBeenCalledWith(
      ws,
      'kiotviet',
      conn().createdAt,
      expect.any(Date),
      20,
    );

    await sync.runJob(store.claimed(jobs[0]!.id));
    expect(order().state).toBe('pushed');
  });
});

describe('reconcile order statuses', () => {
  it('repairs a missed order.update from the order branch since the last reconcile', async () => {
    const last = new Date('2026-11-01T02:00:00.000Z');
    conn().lastReconcileAt = last;
    orders.add(ORDER, { state: 'pushed', externalId: '7001' });
    gateway.orders.push(
      {
        id: 7001,
        code: 'DH7001',
        status: KV_ORDER_STATUS.cancelled,
        description: 'Rapiz DH0012',
        branchId: 3,
        body: {} as never,
      },
      { id: 7002, code: 'DH7002', status: 1, description: null, branchId: 3, body: {} as never },
    );
    const recent = vi.spyOn(gateway, 'recentOrders');
    await sync.runJob(pushJob({ kind: 'reconcile', payload: {} }));

    expect(order()).toMatchObject({ cancelled: true, externalStatus: 'cancelled' });
    expect(recent).toHaveBeenCalledWith(expect.anything(), {
      branchId: 3,
      since: new Date(last.getTime() - 120_000),
      currentItem: 0,
      pageSize: 100,
    });
  });

  it('skips the repair while push is off', async () => {
    conn().settings.pushOrders = false;
    const recent = vi.spyOn(gateway, 'recentOrders');
    await sync.runJob(pushJob({ kind: 'reconcile', payload: {} }));
    expect(recent).not.toHaveBeenCalled();
  });
});
