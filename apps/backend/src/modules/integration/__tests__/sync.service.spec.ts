import { createHmac } from 'node:crypto';

import { workspaceId } from '@agent-sales/shared';
import { Logger } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SecretBox } from '../../../common/security/secret-box.js';
import {
  type CatalogSyncFacade,
  type ExternalCatalogItem,
  ExternalImageError,
  ExternalLinkConflictError,
  type OrderPushFacade,
} from '../../commerce/api/index.js';
import { CatalogImport, SWEEP_CAP } from '../application/catalog-import.js';
import { CatalogWriter } from '../application/catalog-writer.js';
import { ConnectionService } from '../application/connection.service.js';
import { WebhookSet } from '../application/webhook-set.js';
import { OrderPusher } from '../application/order-push.js';
import type {
  ClaimedWebhookEvent,
  ConnectionRecord,
  JobRecord,
} from '../application/ports/integration-store.js';
import type { KvOnHand } from '../application/ports/kiotviet-gateway.js';
import { SyncService } from '../application/sync.service.js';
import { SyncRunner } from '../application/sync-runner.js';
import { parseNotifications, WebhookApplier } from '../application/webhook-apply.js';
import { KiotVietAuthError, KiotVietUnavailableError } from '../domain/integration.errors.js';
import type { KvProduct } from '../domain/kiotviet-mapping.js';
import { UnavailableIntegrationStore } from '../infrastructure/persistence/unavailable-store.js';
import { FakeKiotVietGateway } from './factories/fake-gateway.js';
import { JobStore } from './factories/job-store.js';

const ws = workspaceId('0190f5c2-0000-7000-8000-000000000001');
const box = SecretBox.insecureDevelopmentBox();
const WEBHOOK_SECRET = Buffer.from('webhook-secret-24-bytes!').toString('base64');

/** In-memory CatalogSyncFacade: products by external id, variant links, stock by variant id. */
class MemoryCatalog {
  products = new Map<string, ExternalCatalogItem>();
  archived = new Set<string>();
  stock = new Map<string, number>();
  upserts: Array<{ item: ExternalCatalogItem; partial: boolean }> = [];
  removed: string[][] = [];
  conflicts = new Map<string, number>();
  skip = new Set<string>();

  upsertExternalProduct = vi.fn(
    async (_ws: unknown, _s: unknown, item: ExternalCatalogItem, opts?: { partial?: boolean }) => {
      const left = this.conflicts.get(item.externalId) ?? 0;
      if (left > 0) {
        this.conflicts.set(item.externalId, left - 1);
        throw new ExternalLinkConflictError('products_external');
      }
      this.upserts.push({ item: structuredClone(item), partial: opts?.partial === true });
      const skipped = item.variants.filter((v) => this.skip.has(v.sku)).map((v) => v.sku);
      if (skipped.length === item.variants.length) {
        return { productId: null, created: false, applied: false, skipped };
      }
      const before = this.products.get(item.externalId);
      const named = new Set(item.variants.map((v) => v.externalId));
      // Partial upserts keep the variants the item does not name, as commerce does.
      const kept = opts?.partial
        ? (before?.variants ?? []).filter((v) => !named.has(v.externalId))
        : [];
      this.products.set(item.externalId, {
        ...structuredClone(item),
        variants: [...item.variants, ...kept],
      });
      const created = !before;
      return { productId: `p-${item.externalId}`, created, applied: true, skipped };
    },
  );
  removeExternalProducts = vi.fn(async (_ws: unknown, _s: unknown, ids: string[]) => {
    this.removed.push([...ids]);
    ids.forEach((id) => this.archived.add(id));
    return ids.length;
  });
  setExternalStock = vi.fn(
    async (
      _ws: unknown,
      _s: unknown,
      rows: Array<{ externalVariantId: string; available: number }>,
    ) => {
      rows.forEach((r) => this.stock.set(r.externalVariantId, r.available));
      return rows.length;
    },
  );
  importExternalImage = vi.fn(async (_ws: unknown, url: string) => {
    if (url.includes('bad')) throw new ExternalImageError('unsupported_format');
    return `https://media.test/${url.split('/').pop()}`;
  });
  countExternalProducts = vi.fn(async () => this.products.size);
  linkedExternalIds = vi.fn(async () => ({
    products: [...this.products.keys()].filter((id) => !this.archived.has(id)),
    variants: [...this.products.values()]
      .flatMap((p) => p.variants.map((v) => v.externalId))
      .filter((id) => !this.archived.has(id)),
  }));
  archiveUnlinkedVariants = vi.fn(async () => 0);
  previewExternalMatch = vi.fn();
  /** Unlinks every product, as commerce clears the link columns. */
  releaseExternalSource = vi.fn(async () => {
    const n = this.products.size;
    this.products.clear();
    return n;
  });
}

/** A product already linked in Rapiz under this KiotViet id. */
const linkedItem = (id: string): ExternalCatalogItem => ({
  externalId: id,
  name: `Old ${id}`,
  description: '',
  category: null,
  active: true,
  imageUrls: [],
  variants: [{ externalId: id, sku: `OLD${id}`, name: '', price: 1, weightGram: 0, position: 0 }],
});

const product = (id: number, over: Partial<KvProduct> = {}): KvProduct => ({
  id,
  code: `SP${id}`,
  name: `Sản phẩm ${id}`,
  basePrice: 10_000 * id,
  ...over,
});

/** A fake gateway whose catalog and on-hands are in memory and paged like KiotViet. */
class CatalogGateway extends FakeKiotVietGateway {
  catalog: KvProduct[] = [];
  removed: number[] = [];
  stockRows: KvOnHand[] = [];
  productCalls: Array<{
    currentItem: number;
    lastModifiedFrom: Date | undefined;
    includeInventory?: boolean | undefined;
  }> = [];
  failProducts: Array<{ at: number; error: Error }> = [];

  override products(
    _c: unknown,
    q: {
      currentItem: number;
      pageSize: number;
      lastModifiedFrom?: Date;
      includeInventory?: boolean;
    },
  ) {
    this.productCalls.push({
      currentItem: q.currentItem,
      lastModifiedFrom: q.lastModifiedFrom,
      includeInventory: q.includeInventory,
    });
    const i = this.failProducts.findIndex((f) => f.at === q.currentItem);
    if (i >= 0) return Promise.reject(this.failProducts.splice(i, 1)[0]!.error);
    if (this.fail.products) return Promise.reject(this.fail.products);
    return Promise.resolve({
      data: this.catalog.slice(q.currentItem, q.currentItem + q.pageSize),
      total: this.catalog.length,
      removedIds: this.removed,
    });
  }

  override productById(_c: unknown, id: number) {
    return Promise.resolve(this.catalog.find((p) => p.id === id) ?? null);
  }

  override onHands(_c: unknown, q: { currentItem: number; pageSize: number }) {
    return Promise.resolve({
      data: this.stockRows.slice(q.currentItem, q.currentItem + q.pageSize),
      total: this.stockRows.length,
      removedIds: [],
    });
  }
}

function connection(over: Partial<ConnectionRecord> = {}): ConnectionRecord {
  const now = new Date();
  return {
    id: '0190f5c2-0000-7000-8000-0000000000c1',
    workspaceId: ws,
    provider: 'kiotviet',
    status: 'syncing',
    retailer: 'shopdemo',
    clientId: 'client-1',
    clientSecretSealed: box.seal('secret-1'),
    webhookToken: 'token',
    webhookSecretSealed: box.seal(WEBHOOK_SECRET),
    settings: { saleBranchIds: [1], orderBranchId: 1, pushOrders: false, syncCustomers: false },
    version: 1,
    progress: null,
    counts: {},
    lastError: null,
    lastFullSyncAt: null,
    lastReconcileAt: null,
    connectedByUserId: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  };
}

let jobSeq = 0;
function job(over: Partial<JobRecord> = {}): JobRecord {
  jobSeq += 1;
  return {
    id: `job-${jobSeq}`,
    workspaceId: ws,
    connectionId: '0190f5c2-0000-7000-8000-0000000000c1',
    kind: 'full_import',
    payload: {},
    cursor: null,
    attempts: 0,
    claimToken: `claim-${jobSeq}`,
    ...over,
  };
}

let store: JobStore;
let gateway: CatalogGateway;
let catalog: MemoryCatalog;
let sync: SyncService;
let webhooks: WebhookApplier;
let pusher: OrderPusher;
/** No order to push: these specs cover the catalog; `order-push.spec.ts` covers pushes. */
const noOrders = {
  claimOrdersForPush: async () => [],
  applyExternalOrderStatus: async () => 'unknown',
} as unknown as OrderPushFacade;

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  store = new JobStore();
  gateway = new CatalogGateway();
  catalog = new MemoryCatalog();
  const facade = catalog as unknown as CatalogSyncFacade;
  const writer = new CatalogWriter(store, gateway, facade);
  pusher = new OrderPusher(store, gateway, noOrders);
  sync = new SyncService(
    store,
    new CatalogImport(store, gateway, facade, writer),
    box,
    writer,
    pusher,
    new WebhookSet(gateway, box, { webhookBaseUrl: undefined }),
  );
  webhooks = new WebhookApplier(store, gateway, facade, writer, box, noOrders);
  store.connections.push(connection());
});

const conn = () => store.connections[0]!;
const connections = () =>
  new ConnectionService(
    store,
    gateway,
    catalog as unknown as CatalogSyncFacade,
    box,
    new WebhookSet(gateway, box, { webhookBaseUrl: undefined }),
  );

describe('SyncService full import', () => {
  it('imports every page, then stock, then marks the connection connected', async () => {
    gateway.catalog = Array.from({ length: 150 }, (_, i) => product(i + 1));
    gateway.stockRows = [
      {
        productId: 1,
        inventories: [
          { branchId: 1, onHand: 5, reserved: 1 },
          { branchId: 2, onHand: 9, reserved: 0 },
        ],
      },
    ];
    const j = job();
    await sync.runJob(j);

    expect(gateway.productCalls.map((c) => c.currentItem)).toEqual([0, 100]);
    expect(catalog.products.size).toBe(150);
    // Stock comes from the on-hands phase, not from product pages.
    expect(gateway.productCalls.every((c) => c.includeInventory === false)).toBe(true);
    expect(catalog.upserts.every((u) => u.partial)).toBe(true);
    expect(catalog.stock.get('1')).toBe(4);
    expect(store.completed).toEqual([j.id]);
    expect(conn()).toMatchObject({
      status: 'connected',
      progress: null,
      counts: { products: 150 },
    });
    expect(conn().lastFullSyncAt).toBeInstanceOf(Date);
    expect(conn().lastReconcileAt).toBeInstanceOf(Date);
    expect(store.logs.find((l) => l.code === 'full_sync_done')?.params).toEqual({
      products: 150,
      images_failed: 0,
    });
    // One checkpoint up front, one per product page, one per stock page.
    expect(store.cursors.map((c) => [c['phase'], c['currentItem']])).toEqual([
      ['products', 0],
      ['products', 100],
      ['stock', 0],
      ['finish', 0],
    ]);
  });

  it('resumes from the saved cursor after a page throws', async () => {
    gateway.catalog = Array.from({ length: 150 }, (_, i) => product(i + 1));
    gateway.failProducts = [{ at: 100, error: new Error('boom') }];
    const first = job();
    await sync.runJob(first);
    expect(store.retried).toHaveLength(1);
    expect(store.retried[0]!.error).toBe('sync_failed');
    expect(store.retried[0]!.runAfter.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(store.completed).toEqual([]);
    const saved = store.cursors.at(-1)!;
    expect(saved).toMatchObject({ phase: 'products', currentItem: 100 });

    gateway.productCalls = [];
    await sync.runJob(job({ id: first.id, cursor: saved, attempts: 1 }));
    expect(gateway.productCalls.map((c) => c.currentItem)).toEqual([100]);
    expect(store.completed).toEqual([first.id]);
    expect(conn().status).toBe('connected');
  });

  it('archives linked products and variants a complete full import did not see', async () => {
    catalog.products.set('900', {
      externalId: '900',
      name: 'Old',
      description: '',
      category: null,
      active: true,
      imageUrls: [],
      variants: [{ externalId: '900', sku: 'OLD', name: '', price: 1, weightGram: 0, position: 0 }],
    });
    gateway.catalog = [
      product(1, { hasVariants: true }),
      product(2, {
        masterProductId: 1,
        attributes: [{ attributeName: 'Size', attributeValue: 'M' }],
      }),
    ];
    catalog.products.set('1', {
      externalId: '1',
      name: 'x',
      description: '',
      category: null,
      active: true,
      imageUrls: [],
      variants: [
        { externalId: '1', sku: 'SP1', name: '', price: 1, weightGram: 0, position: 0 },
        { externalId: '3', sku: 'SP3', name: '', price: 1, weightGram: 0, position: 1 },
      ],
    });
    await sync.runJob(job());
    // Variant 3 of product 1 and product 900 are gone from the store.
    expect(catalog.removed.flat().sort()).toEqual(['3', '900']);
    expect(
      catalog.products
        .get('1')!
        .variants.map((v) => v.externalId)
        .sort(),
    ).toEqual(['1', '2', '3']);
    // Rapiz-only variants of adopted products go too.
    expect(catalog.archiveUnlinkedVariants).toHaveBeenCalledTimes(1);
  });

  it('does not sweep when a page came back short', async () => {
    catalog.products.set('900', {
      externalId: '900',
      name: 'Old',
      description: '',
      category: null,
      active: true,
      imageUrls: [],
      variants: [{ externalId: '900', sku: 'OLD', name: '', price: 1, weightGram: 0, position: 0 }],
    });
    gateway.catalog = [product(1), product(2)];
    const products = gateway.products.bind(gateway);
    gateway.products = async (c, q) => {
      const page = await products(c, q);
      return { ...page, data: page.data.slice(1) };
    };
    await sync.runJob(job());
    expect(catalog.removed).toEqual([]);
    expect(catalog.archiveUnlinkedVariants).not.toHaveBeenCalled();
    expect(conn().status).toBe('connected');
  });

  it('does not sweep when the product total changed between pages', async () => {
    catalog.products.set('900', linkedItem('900'));
    gateway.catalog = Array.from({ length: 150 }, (_, i) => product(i + 1));
    const products = gateway.products.bind(gateway);
    gateway.products = async (c, q) => {
      const page = await products(c, q);
      // A product created in KiotViet while the import ran shifts the pages.
      if (q.currentItem === 0) gateway.catalog.unshift(product(5000));
      return page;
    };
    await sync.runJob(job());
    expect(store.cursors.at(-1)).toMatchObject({ incomplete: true, productTotal: 150 });
    expect(catalog.removed).toEqual([]);
    expect(catalog.archiveUnlinkedVariants).not.toHaveBeenCalled();
  });

  it('keeps a stale product KiotViet still has (missed by the paging, not deleted)', async () => {
    catalog.products.set('900', linkedItem('900'));
    catalog.products.set('901', linkedItem('901'));
    gateway.catalog = [product(1)];
    const byId = gateway.productById.bind(gateway);
    gateway.productById = async (c, id) => (id === 901 ? product(901) : byId(c, id));
    await sync.runJob(job());
    expect(catalog.removed).toEqual([['900']]);
  });

  it(`confirms and archives at most ${SWEEP_CAP} stale ids per run, then logs the rest`, async () => {
    for (let id = 1000; id < 1000 + SWEEP_CAP + 5; id++) {
      catalog.products.set(String(id), linkedItem(String(id)));
    }
    gateway.catalog = [product(1)];
    const byId = vi.spyOn(gateway, 'productById');
    await sync.runJob(job());
    expect(byId).toHaveBeenCalledTimes(SWEEP_CAP);
    expect(catalog.removed.flat()).toHaveLength(SWEEP_CAP);
    expect(store.logs.find((l) => l.code === 'sweep_capped')).toMatchObject({
      level: 'warning',
      params: { count: 5 },
    });
    expect(conn().status).toBe('connected');
  });

  it('fetches a missing master and upserts the group partially', async () => {
    gateway.catalog = [
      product(2, {
        masterProductId: 1,
        attributes: [{ attributeName: 'Size', attributeValue: 'M' }],
      }),
    ];
    const master = product(1, { hasVariants: true, images: ['https://kv.test/a.jpg'] });
    gateway.productById = async (_c, id) => (id === 1 ? master : null);
    await sync.runJob(job());
    expect(catalog.upserts).toHaveLength(1);
    expect(catalog.upserts[0]!.item).toMatchObject({
      externalId: '1',
      name: 'Sản phẩm 1',
      imageUrls: ['https://media.test/a.jpg'],
    });
    expect(catalog.upserts[0]!.item.variants.map((v) => v.externalId)).toEqual(['1', '2']);
  });

  it('counts failed pictures once, uses the image cache, and logs SKU conflicts', async () => {
    store.images.set('https://kv.test/cached.jpg', 'https://media.test/cached-stored.jpg');
    gateway.catalog = [
      product(1, { images: ['https://kv.test/bad1.webp', 'https://kv.test/cached.jpg'] }),
      product(2, { images: ['https://kv.test/bad2.webp'] }),
      product(3),
      product(4),
    ];
    catalog.skip.add('SP3');
    catalog.conflicts.set('4', 2);
    await sync.runJob(job());

    expect(catalog.upserts.find((u) => u.item.externalId === '1')?.item.imageUrls).toEqual([
      'https://media.test/cached-stored.jpg',
    ]);
    expect(catalog.importExternalImage).toHaveBeenCalledTimes(2);
    expect(store.logs.filter((l) => l.code === 'image_failed').map((l) => l.params)).toEqual([
      { count: 2 },
    ]);
    expect(store.logs.find((l) => l.code === 'full_sync_done')?.params).toMatchObject({
      images_failed: 2,
    });
    expect(store.logs.filter((l) => l.code === 'sku_conflict').map((l) => l.params)).toEqual([
      { sku: 'SP3' },
      { sku: 'SP4' },
    ]);
    expect(store.completed).toHaveLength(1);
  });

  it('logs nothing when an upsert applies nothing and skips no SKU', async () => {
    gateway.catalog = [product(1)];
    catalog.upsertExternalProduct.mockResolvedValueOnce({
      productId: null,
      created: false,
      applied: false,
      skipped: [],
    });
    await sync.runJob(job());
    expect(store.codes()).not.toContain('sku_conflict');
  });

  it('retries an item once after a link race', async () => {
    gateway.catalog = [product(1)];
    catalog.conflicts.set('1', 1);
    await sync.runJob(job());
    expect(catalog.products.has('1')).toBe(true);
    expect(store.codes()).not.toContain('sku_conflict');
  });
});

describe('SyncService reconcile', () => {
  it('reads changes since the last reconcile minus two minutes and applies removals', async () => {
    const last = new Date(Date.now() - 60 * 60_000);
    store.connections[0] = connection({ status: 'connected', lastReconcileAt: last });
    gateway.catalog = [product(7, { name: 'Đổi tên' })];
    gateway.removed = [55];
    await sync.runJob(job({ kind: 'reconcile' }));
    expect(gateway.productCalls[0]!.lastModifiedFrom?.getTime()).toBe(last.getTime() - 2 * 60_000);
    expect(catalog.products.get('7')?.name).toBe('Đổi tên');
    expect(catalog.removed).toEqual([['55']]);
    expect(conn().lastReconcileAt!.getTime()).toBeGreaterThan(last.getTime());
    expect(conn().lastFullSyncAt).toBeNull();
    expect(store.codes()).not.toContain('full_sync_done');
    // An incremental run never sweeps.
    expect(catalog.linkedExternalIds).not.toHaveBeenCalled();
  });

  it('runs a full reconcile on request and queues another when the sale branches changed', async () => {
    store.connections[0] = connection({ status: 'connected', lastReconcileAt: new Date() });
    gateway.catalog = [product(1)];
    const update = store.updateConnection.bind(store);
    let changed = false;
    // The owner changes the branches while the stock phase runs.
    gateway.onHands = async () => {
      if (!changed) {
        changed = true;
        await update(ws, conn().id, { settings: { ...conn().settings, saleBranchIds: [2] } });
      }
      return { data: [], total: 0, removedIds: [] };
    };
    const j = job({ kind: 'reconcile', payload: { full: true } });
    await sync.runJob(j);
    expect(gateway.productCalls[0]!.lastModifiedFrom).toBeUndefined();
    expect(store.completed).toEqual([j.id]);
    expect(store.jobs.at(-1)).toMatchObject({
      kind: 'reconcile',
      payload: { full: true },
      open: true,
    });
  });
});

describe('SyncService errors and races', () => {
  it('auth error → status error, failJob, auth_failed logged once', async () => {
    gateway.fail.products = new KiotVietAuthError();
    await sync.runJob(job());
    expect(conn()).toMatchObject({
      status: 'error',
      progress: null,
      lastError: { code: 'auth_failed' },
    });
    expect(store.failed.map((f) => f.error)).toEqual(['auth_failed']);
    await sync.runJob(job({ kind: 'reconcile' }));
    expect(store.codes().filter((c) => c === 'auth_failed')).toHaveLength(1);
  });

  it('a secret that no longer opens is an auth failure', async () => {
    store.connections[0] = connection({ clientSecretSealed: 'v1.broken' });
    await sync.runJob(job());
    expect(conn().lastError?.code).toBe('auth_failed');
  });

  it('KiotViet unavailable: retries at +1, +5, +30 min, then fails and logs', async () => {
    gateway.fail.products = new KiotVietUnavailableError();
    const now = Date.now();
    for (const attempts of [0, 1, 2]) await sync.runJob(job({ attempts }));
    expect(store.retried.map((r) => Math.round((r.runAfter.getTime() - now) / 60_000))).toEqual([
      1, 5, 30,
    ]);
    expect(store.retried.every((r) => r.error === 'kiotviet_unavailable')).toBe(true);
    await sync.runJob(job({ attempts: 3 }));
    expect(store.failed.map((f) => f.error)).toEqual(['kiotviet_unavailable']);
    expect(store.codes()).toContain('kiotviet_unavailable');
    expect(conn()).toMatchObject({ status: 'error', lastError: { code: 'kiotviet_unavailable' } });
  });

  it('a disconnect during the run completes the job without further writes', async () => {
    gateway.catalog = Array.from({ length: 150 }, (_, i) => product(i + 1));
    const products = gateway.products.bind(gateway);
    gateway.products = async (c, q) => {
      const page = await products(c, q);
      conn().status = 'disconnected';
      return page;
    };
    const j = job();
    await sync.runJob(j);
    expect(catalog.upserts).toEqual([]);
    expect(store.completed).toEqual([j.id]);
    expect(conn().status).toBe('disconnected');
  });

  it('a disconnect mid-page leaves no product linked', async () => {
    gateway.catalog = Array.from({ length: 5 }, (_, i) => product(i + 1));
    const upsert = catalog.upsertExternalProduct.getMockImplementation()!;
    catalog.upsertExternalProduct.mockImplementationOnce(async (...args) => {
      const res = await upsert(...args);
      // The owner disconnects while the page is being written.
      await connections().disconnect(ws);
      return res;
    });
    const j = job();
    await sync.runJob(j);
    expect(conn().status).toBe('disconnected');
    // The rest of the page stopped at the next item…
    expect(catalog.upsertExternalProduct).toHaveBeenCalledTimes(1);
    // …and nothing written before or after the release keeps its KiotViet link.
    expect(catalog.products.size).toBe(0);
    expect(store.completed).toEqual([j.id]);
  });

  it('releases again when a write lands between the release and the disconnected status', async () => {
    gateway.catalog = [product(1), product(2)];
    const upsert = catalog.upsertExternalProduct.getMockImplementation()!;
    catalog.upsertExternalProduct.mockImplementationOnce(async (...args) => {
      await catalog.releaseExternalSource();
      const res = await upsert(...args);
      conn().status = 'disconnected';
      return res;
    });
    await sync.runJob(job());
    expect(catalog.products.size).toBe(0);
  });

  it('does not release the links of a connection made again meanwhile', async () => {
    gateway.catalog = [product(1), product(2)];
    const upsert = catalog.upsertExternalProduct.getMockImplementation()!;
    catalog.upsertExternalProduct.mockImplementationOnce(async (...args) => {
      const res = await upsert(...args);
      conn().status = 'disconnected';
      store.connections.push(connection({ id: '0190f5c2-0000-7000-8000-0000000000c2' }));
      return res;
    });
    await sync.runJob(job());
    expect(catalog.releaseExternalSource).not.toHaveBeenCalled();
  });

  it('stops at once when the lease is lost', async () => {
    gateway.catalog = [product(1)];
    store.leaseOk = false;
    await sync.runJob(job());
    expect(store.completed).toEqual([]);
    expect(gateway.productCalls).toEqual([]);
  });

  it('completes jobs of a connection whose connect failed, and webhook jobs, with no work', async () => {
    store.connections[0] = connection({
      status: 'error',
      lastError: { code: 'connect_failed', at: new Date().toISOString() },
    });
    await sync.runJob(job());
    store.connections[0] = connection();
    await sync.runJob(job({ kind: 'webhook' }));
    expect(store.completed).toHaveLength(2);
    expect(gateway.productCalls).toEqual([]);
  });
});

const sign = (body: string, secret = WEBHOOK_SECRET) =>
  createHmac('sha256', secret).update(body).digest('hex');
const delivery = (body: object, signature?: string): ClaimedWebhookEvent => {
  const raw = JSON.stringify(body);
  return {
    id: 'evt-1',
    workspaceId: ws,
    connectionId: conn().id,
    body: raw,
    signature: signature ?? `sha256=${sign(raw)}`,
  };
};

describe('WebhookApplier', () => {
  beforeEach(() => {
    store.connections[0] = connection({ status: 'connected' });
  });

  it('drops deliveries with a bad signature, logging the first one per connection only', async () => {
    gateway.catalog = [product(1)];
    const body = { Id: 'd1', Notifications: [{ Action: 'product.update.1', Data: [{ Id: 1 }] }] };
    await webhooks.apply(delivery(body, 'sha256=00'));
    await webhooks.apply({ ...delivery(body), signature: null });
    for (let i = 0; i < 5; i++) await webhooks.apply(delivery(body, 'sha256=00'));
    expect(store.codes()).toEqual(['webhook_bad_signature']);
    expect(catalog.upsertExternalProduct).not.toHaveBeenCalled();
    // The process log keeps the count instead.
    expect(vi.mocked(Logger.prototype.warn)).toHaveBeenCalledWith(
      expect.stringContaining('1 webhook deliveries with a bad signature'),
    );
  });

  it('a disconnect while a delivery applies releases what it wrote', async () => {
    gateway.catalog = [product(1), product(2)];
    const upsert = catalog.upsertExternalProduct.getMockImplementation()!;
    catalog.upsertExternalProduct.mockImplementationOnce(async (...args) => {
      const res = await upsert(...args);
      // The owner disconnects right after the first write; the second must not stay linked.
      await connections().disconnect(ws);
      return res;
    });
    await webhooks.apply(
      delivery({ Notifications: [{ Action: 'product.update.1', Data: [{ Id: 1 }, { Id: 2 }] }] }),
    );
    expect(conn().status).toBe('disconnected');
    expect(catalog.upsertExternalProduct).toHaveBeenCalledTimes(1);
    expect(catalog.products.size).toBe(0);
  });

  it('a disconnect landing after the last item check still releases the write', async () => {
    gateway.catalog = [product(1)];
    const upsert = catalog.upsertExternalProduct.getMockImplementation()!;
    catalog.upsertExternalProduct.mockImplementationOnce(async (...args) => {
      // Old order: release first, then status — the in-flight write lands in between.
      await catalog.releaseExternalSource();
      const res = await upsert(...args);
      conn().status = 'disconnected';
      return res;
    });
    await webhooks.apply(
      delivery({ Notifications: [{ Action: 'product.update.1', Data: [{ Id: 1 }] }] }),
    );
    expect(catalog.products.size).toBe(0);
  });

  it('product.update refetches the product (not the payload) and writes its stock', async () => {
    gateway.catalog = [
      product(1, { name: 'Tên mới', inventories: [{ branchId: 1, onHand: 3, reserved: 0 }] }),
    ];
    await webhooks.apply(
      delivery({
        Notifications: [{ Action: 'product.update.123', Data: [{ Id: 1, Name: 'payload' }] }],
      }),
    );
    expect(catalog.products.get('1')?.name).toBe('Tên mới');
    expect(catalog.upserts[0]!.partial).toBe(true);
    expect(catalog.stock.get('1')).toBe(3);
  });

  it('stock.update and product.delete, unknown actions logged once per type', async () => {
    gateway.catalog = [product(1, { inventories: [{ branchId: 1, onHand: 8, reserved: 2 }] })];
    await webhooks.apply(
      delivery({
        Notifications: [
          { Action: 'stock.update.9', Data: [{ ProductId: 1, OnHand: 999 }] },
          { Action: 'product.delete.9', Data: [{ RemoveId: [5, 6] }] },
          { Action: 'invoice.update.9', Data: [{ Id: 1 }] },
        ],
      }),
    );
    await webhooks.apply(delivery({ Notifications: [{ Action: 'invoice.update.9', Data: [] }] }));
    expect(catalog.stock.get('1')).toBe(6);
    expect(catalog.upsertExternalProduct).not.toHaveBeenCalled();
    expect(catalog.removed).toEqual([['5', '6']]);
    expect(store.logs.filter((l) => l.code === 'webhook_unknown').map((l) => l.params)).toEqual([
      { type: 'invoice.update' },
    ]);
  });

  it('ignores deliveries of a disconnected connection', async () => {
    store.connections[0] = connection({ status: 'disconnected' });
    await webhooks.apply(
      delivery({ Notifications: [{ Action: 'product.delete', Data: [{ RemoveId: [1] }] }] }),
    );
    expect(catalog.removed).toEqual([]);
    expect(store.logs).toEqual([]);
  });

  it('parses notifications tolerantly', () => {
    expect(parseNotifications('not json')).toEqual([]);
    expect(
      parseNotifications('{"notifications":[{"action":"Product.Update","data":[{"id":"4"}]}]}'),
    ).toEqual([{ action: 'product.update', ids: [4] }]);
    expect(parseNotifications('{"Notifications":[{"Data":[]}, 3]}')).toEqual([]);
  });
});

describe('SyncRunner', () => {
  it('skips cleanly without a database', async () => {
    const runner = new SyncRunner(new UnavailableIntegrationStore(), sync, webhooks, pusher);
    await expect(runner.tick()).resolves.toBeUndefined();
  });

  it('queues due reconciles at most once a minute, runs jobs, then webhooks', async () => {
    store.connections[0] = connection({ status: 'connected', lastReconcileAt: new Date() });
    const due = vi.fn(async () => [{ workspaceId: ws, connectionId: conn().id }]);
    store.connectionsDueForReconcile = due;
    const claimed = job({ kind: 'reconcile' });
    store.claimJobs = vi.fn(async () => [claimed]);
    store.events = [
      delivery({ Notifications: [{ Action: 'product.delete', Data: [{ RemoveId: [9] }] }] }),
    ];
    const runner = new SyncRunner(store, sync, webhooks, pusher);
    await runner.tick();
    await runner.tick();
    expect(due).toHaveBeenCalledTimes(1);
    expect(store.claimJobs).toHaveBeenCalledWith(5, 300_000);
    expect(store.jobs.filter((j) => j.kind === 'reconcile')).toHaveLength(1);
    expect(store.completed).toContain(claimed.id);
    expect(catalog.removed).toContainEqual(['9']);
  });
});
