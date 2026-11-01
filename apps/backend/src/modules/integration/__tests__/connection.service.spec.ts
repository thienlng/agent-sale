import { ConnectionDto, KiotVietTestResponse, SyncLogParams } from '@agent-sales/contracts';
import { workspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import type { CatalogSyncFacade, OrderPushFacade } from '../../commerce/api/index.js';
import { ConnectionService } from '../application/connection.service.js';
import { WebhookSet } from '../application/webhook-set.js';
import {
  ConnectFailedError,
  ConnectionExistsError,
  ConnectionNotFoundError,
  ConnectionVersionConflictError,
  KiotVietAuthError,
  KiotVietBranchError,
  KiotVietPermissionError,
  KiotVietRetailerChangedError,
  KiotVietRetailerError,
  KiotVietUnavailableError,
  NothingToUpdateError,
  SyncAlreadyRunningError,
} from '../domain/integration.errors.js';
import { FakeKiotVietGateway } from './factories/fake-gateway.js';
import { MemoryIntegrationStore } from './factories/memory-integration-store.js';

const ws = workspaceId('0190f5c2-0000-7000-8000-000000000001');
const other = workspaceId('0190f5c2-0000-7000-8000-000000000002');
const USER = '0190f5c2-0000-7000-8000-0000000000aa';
const creds = {
  retailer: 'https://ShopDemo.kiotviet.vn/man',
  clientId: 'client-1234',
  clientSecret: 'secret-xyz',
};
const settings = {
  saleBranchIds: [1, 2],
  orderBranchId: 1,
  pushOrders: false,
  syncCustomers: false,
};

function fakeCatalog() {
  return {
    previewExternalMatch: vi.fn(async (_ws, codes: string[]) => ({
      matched: codes.length - 1,
      created: 1,
      rapizOnly: 4,
    })),
    releaseExternalSource: vi.fn(async () => 3),
    countExternalProducts: vi.fn(async () => 0),
    upsertExternalProduct: vi.fn(),
    removeExternalProducts: vi.fn(),
    setExternalStock: vi.fn(),
    importExternalImage: vi.fn(),
    linkedExternalIds: vi.fn(),
    archiveUnlinkedVariants: vi.fn(),
  } satisfies Record<keyof CatalogSyncFacade, unknown>;
}

describe('ConnectionService', () => {
  let store: MemoryIntegrationStore;
  let gateway: FakeKiotVietGateway;
  let catalog: ReturnType<typeof fakeCatalog>;
  let pushOrders: OrderPushFacade;
  let statusAtRelease: string | undefined;
  let box: SecretBox;
  let service: ConnectionService;
  let warn: ReturnType<typeof vi.spyOn>;

  const make = (webhookBaseUrl: string | null = 'https://hooks.rapiz.test/') =>
    new ConnectionService(
      store,
      gateway,
      catalog as unknown as CatalogSyncFacade,
      box,
      new WebhookSet(gateway, box, { webhookBaseUrl: webhookBaseUrl ?? undefined }),
      pushOrders,
    );

  beforeEach(() => {
    store = new MemoryIntegrationStore();
    gateway = new FakeKiotVietGateway();
    catalog = fakeCatalog();
    pushOrders = {
      releasePendingPushes: vi.fn(async () => {
        statusAtRelease = store.connections[0]?.status;
        return 2;
      }),
    } as unknown as OrderPushFacade;
    box = SecretBox.insecureDevelopmentBox();
    service = make();
    warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => warn.mockRestore());

  describe('test', () => {
    it('reads the store name, lists branches and previews the first sync', async () => {
      const res = await service.test(ws, creds);

      expect(KiotVietTestResponse.parse(res)).toEqual({
        retailer: 'shopdemo',
        branches: gateway.branchList,
        preview: { matched: 2, created: 1, rapizOnly: 4, scanned: 3, total: 3 },
      });
      expect(catalog.previewExternalMatch).toHaveBeenCalledWith(ws, ['SP1', 'SP2', 'SP3']);
      expect(gateway.calls.every((c) => c.interactive)).toBe(true);
      expect(gateway.calls[0]?.credentials).toEqual({
        retailer: 'shopdemo',
        clientId: 'client-1234',
        clientSecret: 'secret-xyz',
      });
      expect(store.connections).toEqual([]);
      expect(store.jobs).toEqual([]);
    });

    it('compares at most 3 000 codes and reports the store total', async () => {
      gateway.codes = Array.from({ length: 25_000 }, (_, i) => `C${i}`);
      const res = await service.test(ws, creds);
      expect(gateway.codesRead).toBe(3_000);
      expect(catalog.previewExternalMatch.mock.calls[0]?.[1]).toHaveLength(3_000);
      expect(res.preview).toMatchObject({ scanned: 3_000, total: 25_000 });
    });

    it('reports an unknown store total as null', async () => {
      gateway.total = null;
      expect((await service.test(ws, creds)).preview.total).toBeNull();
    });

    it('rejects a store name that is not one before calling KiotViet', async () => {
      await expect(
        service.test(ws, { ...creds, retailer: 'abc.example.com' }),
      ).rejects.toBeInstanceOf(KiotVietRetailerError);
      expect(gateway.calls).toEqual([]);
    });

    it.each([
      ['auth', new KiotVietAuthError()],
      ['retailer', new KiotVietRetailerError()],
      ['permission', new KiotVietPermissionError(['branches'])],
      ['unavailable', new KiotVietUnavailableError()],
    ])('passes a KiotViet %s error through', async (_name, error) => {
      gateway.fail.branches = error;
      await expect(service.test(ws, creds)).rejects.toBe(error);
    });
  });

  describe('connect', () => {
    it('stores sealed secrets, registers webhooks, queues the import and never returns secrets', async () => {
      const dto = await service.connect(ws, USER, { ...creds, settings });

      expect(ConnectionDto.parse(dto)).toEqual(dto);
      expect(dto).toMatchObject({
        provider: 'kiotviet',
        status: 'syncing',
        retailer: 'shopdemo',
        clientIdMasked: '••••1234',
        settings,
        branches: gateway.branchList,
        counts: { products: 0, customers: 0, ordersPushed: 0 },
        progress: null,
        lastSyncAt: null,
        lastError: null,
      });
      const body = JSON.stringify(dto);
      expect(body).not.toContain('secret-xyz');
      expect(body).not.toContain('client-1234');

      const [row] = store.connections;
      expect(row).toBeDefined();
      expect(row!.clientSecretSealed).not.toContain('secret-xyz');
      expect(box.open(row!.clientSecretSealed)).toBe('secret-xyz');
      expect(row!.webhookToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const webhookSecret = box.open(row!.webhookSecretSealed);
      expect(Buffer.from(webhookSecret, 'base64')).toHaveLength(24);
      expect(row!.connectedByUserId).toBe(USER);

      expect(gateway.webhooks.map((h) => h.type)).toEqual([
        'product.update',
        'product.delete',
        'stock.update',
      ]);
      for (const h of gateway.webhooks) {
        expect(h.url).toBe(`https://hooks.rapiz.test/webhooks/kiotviet/${row!.webhookToken}`);
        expect(h.secretBase64).toBe(webhookSecret);
      }
      expect(row!.settings.webhookIds).toEqual(gateway.webhooks.map((h) => h.id));
      expect(dto.version).toBe(row!.version);

      expect(store.jobs).toMatchObject([{ kind: 'full_import', connectionId: row!.id }]);
      expect(store.logs.map((l) => l.code)).toEqual(['connected']);
      // The params `log.connected` interpolates ("Đã kết nối gian hàng {{retailer}}").
      expect(SyncLogParams.connected.parse(store.logs[0]!.params)).toEqual({
        retailer: 'shopdemo',
        branches: 2,
      });
      expect(gateway.calls.every((c) => c.interactive)).toBe(true);
    });

    it('refuses a second live connection with 409 before calling KiotViet', async () => {
      await service.connect(ws, USER, { ...creds, settings });
      gateway.calls = [];
      await expect(service.connect(ws, USER, { ...creds, settings })).rejects.toBeInstanceOf(
        ConnectionExistsError,
      );
      expect(gateway.calls).toEqual([]);
      // Another workspace is independent.
      await expect(service.connect(other, USER, { ...creds, settings })).resolves.toBeDefined();
    });

    it('rejects sale branches the store does not have', async () => {
      await expect(
        service.connect(ws, USER, { ...creds, settings: { ...settings, saleBranchIds: [1, 9] } }),
      ).rejects.toEqual(new KiotVietBranchError([9]));
      expect(store.connections).toEqual([]);
    });

    it('passes rejected credentials through and stores nothing', async () => {
      gateway.fail.branches = new KiotVietAuthError();
      await expect(service.connect(ws, USER, { ...creds, settings })).rejects.toBeInstanceOf(
        KiotVietAuthError,
      );
      expect(store.connections).toEqual([]);
    });

    it('keeps the connection when webhook registration fails and logs it', async () => {
      gateway.fail.registerWebhook = new KiotVietUnavailableError();
      const dto = await service.connect(ws, USER, { ...creds, settings });

      expect(dto.status).toBe('syncing');
      expect(store.connections[0]!.settings.webhookIds).toEqual([]);
      expect(store.logs.map((l) => [l.level, l.code])).toEqual([
        ['warning', 'webhook_register_failed'],
        ['info', 'connected'],
      ]);
      expect(store.jobs).toHaveLength(1);
    });

    it('skips webhook registration without a public webhook base URL', async () => {
      service = make(null);
      await service.connect(ws, USER, { ...creds, settings });
      expect(gateway.webhooks).toEqual([]);
      expect(store.logs.map((l) => l.code)).toEqual(['webhook_register_failed', 'connected']);
    });

    it('marks the connection in error when the import cannot be queued', async () => {
      store.enqueue = () => Promise.reject(new Error('db down'));
      await expect(service.connect(ws, USER, { ...creds, settings })).rejects.toThrow('db down');
      expect(store.connections[0]).toMatchObject({
        status: 'error',
        lastError: { code: 'connect_failed' },
      });
      // Nothing was registered at KiotViet before the job was queued.
      expect(gateway.webhooks).toEqual([]);
    });

    it('saves each webhook id at once and marks the error when a save fails', async () => {
      const update = store.updateConnection.bind(store);
      let saves = 0;
      store.updateConnection = (w, id, patch, v) =>
        patch.settings && ++saves === 2
          ? Promise.reject(new Error('db down'))
          : update(w, id, patch, v);

      await expect(service.connect(ws, USER, { ...creds, settings })).rejects.toThrow('db down');
      const row = store.connections[0]!;
      expect(row.status).toBe('error');
      expect(row.settings.webhookIds).toEqual([gateway.webhooks[0]!.id]);
      // Two webhooks exist at KiotViet but only one id was saved: disconnect still removes both.
      expect(gateway.webhooks).toHaveLength(2);
      await service.disconnect(ws);
      expect(gateway.webhooks).toEqual([]);
    });

    it('never logs the secrets', async () => {
      gateway.fail.registerWebhook = new KiotVietUnavailableError();
      await service.connect(ws, USER, { ...creds, settings });
      const row = store.connections[0]!;
      const output = JSON.stringify([warn.mock.calls, store.logs]);
      expect(output).not.toContain('secret-xyz');
      expect(output).not.toContain(box.open(row.webhookSecretSealed));
    });
  });

  describe('update', () => {
    const connect = () => service.connect(ws, USER, { ...creds, settings });

    it('answers 400 when there is nothing to change', async () => {
      const dto = await connect();
      await expect(service.update(ws, { version: dto.version })).rejects.toBeInstanceOf(
        NothingToUpdateError,
      );
    });

    it('answers 404 when not connected', async () => {
      await expect(service.update(ws, { version: 1, settings })).rejects.toBeInstanceOf(
        ConnectionNotFoundError,
      );
    });

    it('refuses a stale version with 409', async () => {
      const dto = await connect();
      await expect(
        service.update(ws, { version: dto.version - 1, settings }),
      ).rejects.toBeInstanceOf(ConnectionVersionConflictError);
    });

    it('changes toggles without a reconcile and keeps webhook ids and branches', async () => {
      const dto = await connect();
      store.jobs.forEach((j) => (j.open = false));
      const updated = await service.update(ws, {
        version: dto.version,
        settings: { ...settings, pushOrders: true, orderBranchId: 2 },
      });
      expect(updated.settings).toEqual({ ...settings, pushOrders: true, orderBranchId: 2 });
      expect(updated.version).toBe(dto.version + 1);
      expect(updated.branches).toEqual(gateway.branchList);
      expect(store.jobs.filter((j) => j.open)).toEqual([]);
    });

    it('ensures the webhook set on a settings save: order.update follows pushOrders', async () => {
      const dto = await connect();
      const on = await service.update(ws, {
        version: dto.version,
        settings: { ...settings, pushOrders: true },
      });
      const row = () => store.connections[0]!;
      expect(gateway.webhooks.map((h) => h.type)).toEqual([
        'product.update',
        'product.delete',
        'stock.update',
        'order.update',
      ]);
      expect(gateway.webhooks.at(-1)?.secretBase64).toBe(box.open(row().webhookSecretSealed));
      expect(row().settings.webhookIds).toEqual(gateway.webhooks.map((h) => h.id));
      // One owner write: the ids ride along with the settings.
      expect(on.version).toBe(dto.version + 1);

      // A lost catalog webhook is registered again; turning push off removes order.update.
      gateway.webhooks = gateway.webhooks.filter((h) => h.type !== 'stock.update');
      await service.update(ws, { version: on.version, settings });
      expect(gateway.webhooks.map((h) => h.type).sort()).toEqual([
        'product.delete',
        'product.update',
        'stock.update',
      ]);
      expect([...row().settings.webhookIds!].sort()).toEqual(
        gateway.webhooks.map((h) => h.id).sort(),
      );
      expect(store.logs.map((l) => l.code)).not.toContain('webhook_register_failed');
    });

    it('saves the settings when KiotViet cannot list webhooks, and logs a failed registration', async () => {
      const dto = await connect();
      gateway.fail.listWebhooks = new Error('down');
      const saved = await service.update(ws, {
        version: dto.version,
        settings: { ...settings, pushOrders: true },
      });
      expect(saved.settings.pushOrders).toBe(true);
      expect(store.connections[0]!.settings.webhookIds).toHaveLength(3);

      delete gateway.fail.listWebhooks;
      gateway.fail.registerWebhook = new Error('down');
      await service.update(ws, {
        version: saved.version,
        settings: { ...settings, pushOrders: true },
      });
      expect(store.logs.find((l) => l.code === 'webhook_register_failed')?.params).toEqual({
        registered: 3,
        expected: 4,
      });
    });

    it('queues a full reconcile when the sale branches change', async () => {
      const dto = await connect();
      store.jobs.forEach((j) => (j.open = false));
      await service.update(ws, {
        version: dto.version,
        settings: { ...settings, saleBranchIds: [1], orderBranchId: 1 },
      });
      expect(store.jobs.filter((j) => j.open)).toMatchObject([
        { kind: 'reconcile', payload: { full: true } },
      ]);
    });

    it('checks a branch the stored list does not know against KiotViet', async () => {
      const dto = await connect();
      gateway.branchList.push({ id: 3, name: 'Mới', address: null });
      const updated = await service.update(ws, {
        version: dto.version,
        settings: { ...settings, saleBranchIds: [3], orderBranchId: 3 },
      });
      expect(updated.branches.map((b) => b.id)).toEqual([1, 2, 3]);
      await expect(
        service.update(ws, {
          version: updated.version,
          settings: { ...settings, saleBranchIds: [8], orderBranchId: 8 },
        }),
      ).rejects.toEqual(new KiotVietBranchError([8]));
    });

    it('re-tests new credentials, reseals the secret and clears the error', async () => {
      const dto = await connect();
      const id = store.connections[0]!.id;
      await store.updateConnection(ws, id, {
        status: 'error',
        lastError: { code: 'kiotviet_auth', at: new Date().toISOString() },
      });
      gateway.calls = [];

      const updated = await service.update(ws, {
        version: dto.version,
        credentials: { retailer: 'shopdemo', clientId: 'client-5678', clientSecret: 'rotated' },
      });

      expect(gateway.calls).toMatchObject([{ method: 'branches', interactive: true }]);
      expect(updated).toMatchObject({
        status: 'connected',
        lastError: null,
        clientIdMasked: '••••5678',
      });
      expect(box.open(store.connections[0]!.clientSecretSealed)).toBe('rotated');
      expect(JSON.stringify(updated)).not.toContain('rotated');
    });

    it('answers the update-the-code error when the stored secret no longer opens', async () => {
      const dto = await connect();
      store.connections[0]!.clientSecretSealed = 'v1.broken.sealed.value';
      await expect(
        service.update(ws, {
          version: dto.version,
          settings: { ...settings, saleBranchIds: [7], orderBranchId: 7 },
        }),
      ).rejects.toBeInstanceOf(KiotVietAuthError);
    });

    it('refuses credentials of another store', async () => {
      const dto = await connect();
      await expect(
        service.update(ws, {
          version: dto.version,
          credentials: { retailer: 'othershop', clientId: 'c', clientSecret: 's' },
        }),
      ).rejects.toBeInstanceOf(KiotVietRetailerChangedError);
    });

    it('keeps the old secret when the new credentials are rejected', async () => {
      const dto = await connect();
      const sealed = store.connections[0]!.clientSecretSealed;
      gateway.fail.branches = new KiotVietAuthError();
      await expect(
        service.update(ws, {
          version: dto.version,
          credentials: { ...creds, clientSecret: 'bad' },
        }),
      ).rejects.toBeInstanceOf(KiotVietAuthError);
      expect(store.connections[0]!.clientSecretSealed).toBe(sealed);
    });
  });

  describe('syncNow', () => {
    it('queues a reconcile, 409 while one is open, 404 when not connected', async () => {
      await expect(service.syncNow(ws)).rejects.toBeInstanceOf(ConnectionNotFoundError);
      await service.connect(ws, USER, { ...creds, settings });
      await expect(service.syncNow(ws)).rejects.toBeInstanceOf(SyncAlreadyRunningError);
      store.jobs.forEach((j) => (j.open = false));
      await service.syncNow(ws);
      expect(store.jobs.filter((j) => j.open)).toMatchObject([{ kind: 'reconcile', payload: {} }]);
    });

    it('refuses with 409 connect_failed when the connect step failed (the runner would skip it)', async () => {
      await service.connect(ws, USER, { ...creds, settings });
      store.jobs.forEach((j) => (j.open = false));
      await store.updateConnection(ws, store.connections[0]!.id, {
        status: 'error',
        lastError: { code: 'connect_failed', at: new Date().toISOString() },
      });
      const error = await service.syncNow(ws).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ConnectFailedError);
      expect(error).toMatchObject({ code: 'CONFLICT', details: { reason: 'connect_failed' } });
      expect(store.jobs.filter((j) => j.open)).toEqual([]);
    });
  });

  describe('disconnect', () => {
    it('marks the connection disconnected before releasing the links', async () => {
      await service.connect(ws, USER, { ...creds, settings });
      // A running job re-reads the status: it must already be `disconnected` when the release runs.
      catalog.releaseExternalSource.mockImplementation(async () => {
        expect(store.connections[0]!.status).toBe('disconnected');
        return 0;
      });
      await service.disconnect(ws);
      expect(catalog.releaseExternalSource).toHaveBeenCalledTimes(1);
    });

    it('deletes webhooks, releases products and marks the connection disconnected', async () => {
      await service.connect(ws, USER, { ...creds, settings });
      await service.disconnect(ws);

      expect(gateway.webhooks).toEqual([]);
      expect(gateway.calls.filter((c) => c.method === 'deleteWebhook')[0]?.credentials).toEqual({
        retailer: 'shopdemo',
        clientId: 'client-1234',
        clientSecret: 'secret-xyz',
      });
      expect(catalog.releaseExternalSource).toHaveBeenCalledWith(ws, 'kiotviet');
      // Orders claimed for a push no job will run any more go back to unclaimed, after the status.
      expect(pushOrders.releasePendingPushes).toHaveBeenCalledWith(ws, 'kiotviet');
      expect(statusAtRelease).toBe('disconnected');
      expect(store.connections[0]!.status).toBe('disconnected');
      expect(await store.liveConnection(ws, 'kiotviet')).toBeNull();
      // A new connection is allowed afterwards.
      await expect(service.connect(ws, USER, { ...creds, settings })).resolves.toBeDefined();
    });

    it('still disconnects when KiotViet refuses to delete the webhooks', async () => {
      await service.connect(ws, USER, { ...creds, settings });
      gateway.fail.deleteWebhook = new KiotVietAuthError();
      await service.disconnect(ws);
      expect(store.connections[0]!.status).toBe('disconnected');
      expect(catalog.releaseExternalSource).toHaveBeenCalled();
    });

    it('answers 404 when not connected, including twice', async () => {
      await expect(service.disconnect(ws)).rejects.toBeInstanceOf(ConnectionNotFoundError);
      await service.connect(ws, USER, { ...creds, settings });
      await service.disconnect(ws);
      await expect(service.disconnect(ws)).rejects.toBeInstanceOf(ConnectionNotFoundError);
    });
  });

  describe('list and log', () => {
    it('lists KiotViet with its connection and the coming-soon providers', async () => {
      expect(await service.list(ws)).toEqual({
        providers: [
          { provider: 'kiotviet', available: true, connection: null },
          { provider: 'sapo', available: false, connection: null },
          { provider: 'haravan', available: false, connection: null },
          { provider: 'pancake_pos', available: false, connection: null },
        ],
      });
      await service.connect(ws, USER, { ...creds, settings });
      const listed = await service.list(ws);
      expect(listed.providers[0]?.connection).toMatchObject({ retailer: 'shopdemo' });
      expect(await service.list(other)).toMatchObject({
        providers: [{ provider: 'kiotviet', connection: null }, {}, {}, {}],
      });
    });

    it('reports the last sync time and the progress', async () => {
      await service.connect(ws, USER, { ...creds, settings });
      const id = store.connections[0]!.id;
      await store.updateConnection(ws, id, {
        lastFullSyncAt: new Date('2026-11-01T01:00:00Z'),
        lastReconcileAt: new Date('2026-11-01T02:00:00Z'),
        progress: { phase: 'products', done: 300, total: 1240 },
        counts: { products: 42 },
      });
      const [kv] = (await service.list(ws)).providers;
      expect(kv?.connection).toMatchObject({
        lastSyncAt: '2026-11-01T02:00:00.000Z',
        progress: { phase: 'products', done: 300, total: 1240 },
        counts: { products: 42, customers: 0, ordersPushed: 0 },
      });
    });

    it('returns the newest log entries first, 404 when not connected', async () => {
      await expect(service.log(ws)).rejects.toBeInstanceOf(ConnectionNotFoundError);
      await service.connect(ws, USER, { ...creds, settings });
      await store.log(ws, store.connections[0]!.id, {
        level: 'error',
        code: 'kiotviet_auth',
        params: { n: 1 },
      });
      const { entries } = await service.log(ws);
      expect(entries.map((e) => e.code)).toEqual(['kiotviet_auth', 'connected']);
      expect(entries[0]).toMatchObject({ level: 'error', params: { n: 1 } });
      expect(typeof entries[0]?.at).toBe('string');
    });
  });
});
