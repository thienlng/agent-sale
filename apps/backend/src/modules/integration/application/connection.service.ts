import { randomBytes } from 'node:crypto';

import type {
  ConnectionDto,
  ConnectKiotVietRequest,
  IntegrationListResponse,
  KiotVietCredentials,
  KiotVietTestResponse,
  SyncLogResponse,
  SyncProgress,
  UpdateKiotVietRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import { CATALOG_SYNC_FACADE, type CatalogSyncFacade } from '../../commerce/api/index.js';
import {
  ConnectionExistsError,
  ConnectionNotFoundError,
  ConnectionVersionConflictError,
  KiotVietBranchError,
  KiotVietRetailerChangedError,
  KiotVietRetailerError,
  NothingToUpdateError,
  SyncAlreadyRunningError,
} from '../domain/integration.errors.js';
import { parseRetailer } from '../domain/retailer.js';
import { INTEGRATION_OPTIONS, type IntegrationOptions } from './integration-options.js';
import {
  type ConnectionRecord,
  type ConnectionSettings,
  INTEGRATION_STORE,
  type IntegrationStore,
} from './ports/integration-store.js';
import {
  KIOTVIET_GATEWAY,
  type KiotVietGateway,
  type KvBranch,
  type KvCredentials,
} from './ports/kiotviet-gateway.js';

const PROVIDER = 'kiotviet';
/** The first-sync preview reads at most this many product codes (200 pages). */
const MAX_PREVIEW_CODES = 20_000;
/** Events that keep the catalog fresh between reconciles (spec §5.3). */
const WEBHOOK_TYPES = ['product.update', 'product.delete', 'stock.update'] as const;
const COMING_SOON = ['sapo', 'haravan', 'pancake_pos'] as const;
const LOG_LIMIT = 200;
const PROGRESS_PHASES: ReadonlySet<string> = new Set([
  'branches',
  'categories',
  'products',
  'stock',
]);

/**
 * Connect, test, change and disconnect a workspace's KiotViet store (spec §4.5, §6.3, §8).
 * Calls the owner waits on use the gateway's interactive view (no retries, short timeout).
 * Secrets are sealed with the SecretBox and never returned or logged (rule 07).
 */
@Injectable()
export class ConnectionService {
  private readonly logger = new Logger(ConnectionService.name);

  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(KIOTVIET_GATEWAY) private readonly gateway: KiotVietGateway,
    @Inject(CATALOG_SYNC_FACADE) private readonly catalog: CatalogSyncFacade,
    @Inject(SECRET_BOX) private readonly secrets: SecretBox,
    @Inject(INTEGRATION_OPTIONS) private readonly options: IntegrationOptions,
  ) {}

  async list(ws: WorkspaceId): Promise<IntegrationListResponse> {
    const live = await this.store.liveConnection(ws, PROVIDER);
    return {
      providers: [
        { provider: PROVIDER, available: true, connection: live ? toDto(live) : null },
        ...COMING_SOON.map((provider) => ({ provider, available: false, connection: null })),
      ],
    };
  }

  /** Checks the credentials and previews the first sync. Stores nothing. */
  async test(ws: WorkspaceId, input: KiotVietCredentials): Promise<KiotVietTestResponse> {
    const creds = credentials(input);
    const kv = this.gateway.interactive();
    const branches = await kv.branches(creds);
    const codes: string[] = [];
    for await (const code of kv.productCodes(creds)) {
      codes.push(code);
      if (codes.length >= MAX_PREVIEW_CODES) break;
    }
    const preview = await this.catalog.previewExternalMatch(ws, codes);
    return { retailer: creds.retailer, branches, preview };
  }

  async connect(
    ws: WorkspaceId,
    userId: string,
    req: ConnectKiotVietRequest,
  ): Promise<ConnectionDto> {
    if (await this.store.liveConnection(ws, PROVIDER)) throw new ConnectionExistsError(PROVIDER);
    const creds = credentials(req);
    const kv = this.gateway.interactive();
    const branches = await kv.branches(creds);
    assertBranches(req.settings.saleBranchIds, branches);

    const webhookSecret = randomBytes(24).toString('base64');
    const now = new Date();
    const record: ConnectionRecord = {
      id: newId(),
      workspaceId: ws,
      provider: PROVIDER,
      status: 'syncing',
      retailer: creds.retailer,
      clientId: creds.clientId,
      clientSecretSealed: this.secrets.seal(creds.clientSecret),
      webhookToken: randomBytes(32).toString('base64url'),
      webhookSecretSealed: this.secrets.seal(webhookSecret),
      settings: { ...req.settings, branches, webhookIds: [] },
      version: 1,
      progress: null,
      counts: {},
      lastError: null,
      lastFullSyncAt: null,
      lastReconcileAt: null,
      connectedByUserId: userId,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.insertConnection(ws, record);

    const webhookIds = await this.registerWebhooks(ws, record, creds, webhookSecret);
    const saved = await this.store.updateConnection(ws, record.id, {
      settings: { ...record.settings, webhookIds },
    });
    await this.store.enqueue(ws, { connectionId: record.id, kind: 'full_import' });
    await this.store.log(ws, record.id, {
      level: 'info',
      code: 'connected',
      params: { branches: req.settings.saleBranchIds.length },
    });
    return toDto(saved);
  }

  async update(ws: WorkspaceId, req: UpdateKiotVietRequest): Promise<ConnectionDto> {
    if (!req.settings && !req.credentials) throw new NothingToUpdateError();
    const current = await this.live(ws);
    // Fail fast before calling KiotViet; the store re-checks the version atomically.
    if (current.version !== req.version) throw new ConnectionVersionConflictError();

    const kv = this.gateway.interactive();
    const patch: Partial<ConnectionRecord> = {};
    let branches = current.settings.branches ?? [];

    if (req.credentials) {
      const creds = credentials(req.credentials);
      if (creds.retailer !== current.retailer) throw new KiotVietRetailerChangedError();
      branches = await kv.branches(creds);
      patch.clientId = creds.clientId;
      patch.clientSecretSealed = this.secrets.seal(creds.clientSecret);
      patch.lastError = null;
      if (current.status === 'error') patch.status = 'connected';
    }

    let salesChanged = false;
    if (req.settings) {
      const known = new Set(branches.map((b) => b.id));
      if (!req.credentials && req.settings.saleBranchIds.some((id) => !known.has(id))) {
        // A branch opened after the connection: refresh the list before refusing it.
        branches = await kv.branches(this.storedCredentials(current));
      }
      assertBranches(req.settings.saleBranchIds, branches);
      salesChanged = !sameIds(req.settings.saleBranchIds, current.settings.saleBranchIds);
    }

    patch.settings = { ...current.settings, ...req.settings, branches };
    const saved = await this.store.updateConnection(ws, current.id, patch, req.version);
    if (salesChanged) {
      const queued = await this.store.enqueue(ws, {
        connectionId: current.id,
        kind: 'reconcile',
        payload: { full: true },
      });
      // A sync is already open; the periodic reconcile picks the new branches up.
      if (!queued)
        this.logger.log(`Connection ${current.id}: branch change waits for the open sync`);
    }
    return toDto(saved);
  }

  /** "Đồng bộ ngay": queues a reconcile. */
  async syncNow(ws: WorkspaceId): Promise<void> {
    const current = await this.live(ws);
    const queued = await this.store.enqueue(ws, { connectionId: current.id, kind: 'reconcile' });
    if (!queued) throw new SyncAlreadyRunningError();
  }

  async log(ws: WorkspaceId): Promise<SyncLogResponse> {
    const current = await this.live(ws);
    const entries = await this.store.recentLog(ws, current.id, LOG_LIMIT);
    return {
      entries: entries.map((e) => ({
        id: e.id,
        level: e.level as SyncLogResponse['entries'][number]['level'],
        code: e.code,
        params: e.params,
        at: e.at.toISOString(),
      })),
    };
  }

  /** Deletes the webhooks at KiotViet (best effort), releases the linked products, then disconnects. */
  async disconnect(ws: WorkspaceId): Promise<void> {
    const current = await this.live(ws);
    await this.deleteWebhooks(current);
    await this.catalog.releaseExternalSource(ws, PROVIDER);
    await this.store.updateConnection(ws, current.id, { status: 'disconnected' });
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async live(ws: WorkspaceId): Promise<ConnectionRecord> {
    const current = await this.store.liveConnection(ws, PROVIDER);
    if (!current) throw new ConnectionNotFoundError(PROVIDER);
    return current;
  }

  private storedCredentials(c: ConnectionRecord): KvCredentials {
    return {
      retailer: c.retailer,
      clientId: c.clientId,
      clientSecret: this.secrets.open(c.clientSecretSealed),
    };
  }

  /** Returns the ids that registered; a failure is logged and the periodic reconcile covers it. */
  private async registerWebhooks(
    ws: WorkspaceId,
    c: ConnectionRecord,
    creds: KvCredentials,
    secretBase64: string,
  ): Promise<number[]> {
    const base = this.options.webhookBaseUrl?.replace(/\/+$/, '');
    const ids: number[] = [];
    let failure = base ? '' : 'no_public_webhook_base_url';
    if (base) {
      const url = `${base}/webhooks/kiotviet/${c.webhookToken}`;
      const kv = this.gateway.interactive();
      for (const type of WEBHOOK_TYPES) {
        try {
          ids.push(await kv.registerWebhook(creds, { type, url, secretBase64 }));
        } catch (error) {
          failure = errorName(error);
          break;
        }
      }
    }
    if (failure) {
      this.logger.warn(`Connection ${c.id}: webhook registration failed (${failure})`);
      await this.store.log(ws, c.id, {
        level: 'warning',
        code: 'webhook_register_failed',
        params: { registered: ids.length, expected: WEBHOOK_TYPES.length },
      });
    }
    return ids;
  }

  private async deleteWebhooks(c: ConnectionRecord): Promise<void> {
    const ids = c.settings.webhookIds ?? [];
    if (!ids.length) return;
    let creds: KvCredentials;
    try {
      creds = this.storedCredentials(c);
    } catch {
      this.logger.warn(
        `Connection ${c.id}: cannot open the sealed secret; webhooks left at KiotViet`,
      );
      return;
    }
    const kv = this.gateway.interactive();
    for (const id of ids) {
      try {
        await kv.deleteWebhook(creds, id);
      } catch (error) {
        this.logger.warn(`Connection ${c.id}: webhook ${id} not deleted (${errorName(error)})`);
      }
    }
  }
}

/** Store name from what the owner pasted, with the trimmed id and secret. */
function credentials(input: KiotVietCredentials): KvCredentials {
  const retailer = parseRetailer(input.retailer);
  if (!retailer) throw new KiotVietRetailerError();
  return { retailer, clientId: input.clientId, clientSecret: input.clientSecret };
}

function assertBranches(saleBranchIds: number[], branches: KvBranch[]): void {
  const known = new Set(branches.map((b) => b.id));
  const unknown = saleBranchIds.filter((id) => !known.has(id));
  if (unknown.length) throw new KiotVietBranchError(unknown);
}

function sameIds(a: number[], b: number[]): boolean {
  const set = new Set(a);
  return set.size === new Set(b).size && b.every((id) => set.has(id));
}

const errorName = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : 'unknown';

const maskClientId = (clientId: string): string => `••••${clientId.slice(-4)}`;

function latest(...dates: Array<Date | null>): Date | null {
  return dates.reduce<Date | null>((a, d) => (d && (!a || d > a) ? d : a), null);
}

function progressOf(p: ConnectionRecord['progress']): SyncProgress | null {
  if (!p || !PROGRESS_PHASES.has(p.phase)) return null;
  return { phase: p.phase as SyncProgress['phase'], done: p.done, total: p.total };
}

function settingsOf(s: ConnectionSettings): ConnectionDto['settings'] {
  return {
    saleBranchIds: s.saleBranchIds,
    orderBranchId: s.orderBranchId,
    pushOrders: s.pushOrders,
    syncCustomers: s.syncCustomers,
  };
}

/** The API view of a connection: no secrets, the client id masked to its last 4 characters. */
export function toDto(c: ConnectionRecord): ConnectionDto {
  const lastSync = latest(c.lastFullSyncAt, c.lastReconcileAt);
  return {
    id: c.id,
    provider: PROVIDER,
    status: c.status,
    retailer: c.retailer,
    clientIdMasked: maskClientId(c.clientId),
    settings: settingsOf(c.settings),
    branches: c.settings.branches ?? [],
    counts: {
      products: c.counts.products ?? 0,
      customers: c.counts.customers ?? 0,
      ordersPushed: c.counts.ordersPushed ?? 0,
    },
    progress: progressOf(c.progress),
    lastSyncAt: lastSync ? lastSync.toISOString() : null,
    lastError: c.lastError,
    version: c.version,
  };
}
