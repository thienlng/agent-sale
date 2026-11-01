import { randomBytes } from 'node:crypto';

import type {
  ConnectionDto,
  ConnectKiotVietRequest,
  IntegrationListResponse,
  KiotVietCredentials,
  KiotVietTestResponse,
  SyncLogParams,
  SyncLogResponse,
  SyncProgress,
  UpdateKiotVietRequest,
} from '@agent-sales/contracts';
import { newId, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import {
  CATALOG_SYNC_FACADE,
  type CatalogSyncFacade,
  ORDER_PUSH_FACADE,
  type OrderPushFacade,
} from '../../commerce/api/index.js';
import {
  ConnectFailedError,
  ConnectionExistsError,
  ConnectionNotFoundError,
  ConnectionVersionConflictError,
  KiotVietAuthError,
  KiotVietBranchError,
  KiotVietRetailerChangedError,
  KiotVietRetailerError,
  NothingToUpdateError,
  SyncAlreadyRunningError,
} from '../domain/integration.errors.js';
import { parseRetailer } from '../domain/retailer.js';
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
import { WebhookSet } from './webhook-set.js';

const PROVIDER = 'kiotviet';
/**
 * The first-sync preview compares at most this many product codes (30 pages), so the check answers
 * well inside the proxy timeout and spends little of the store's hourly budget.
 */
const MAX_PREVIEW_CODES = 3_000;
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
    @Inject(WebhookSet) private readonly webhooks: WebhookSet,
    @Inject(ORDER_PUSH_FACADE) private readonly orders: OrderPushFacade,
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
    const total = await kv.productCount(creds);
    const codes: string[] = [];
    for await (const code of kv.productCodes(creds)) {
      codes.push(code);
      if (codes.length >= MAX_PREVIEW_CODES) break;
    }
    const match = await this.catalog.previewExternalMatch(ws, codes);
    return {
      retailer: creds.retailer,
      branches,
      preview: { ...match, scanned: codes.length, total },
    };
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

    // From here the connection exists: any failure leaves it visibly in error, never silently
    // `syncing` without a job.
    try {
      await this.store.enqueue(ws, { connectionId: record.id, kind: 'full_import' });
      const saved = await this.registerWebhooks(ws, record, creds, webhookSecret);
      await this.store.log(ws, record.id, {
        level: 'info',
        code: 'connected',
        params: {
          retailer: creds.retailer,
          branches: req.settings.saleBranchIds.length,
        } satisfies SyncLogParams['connected'],
      });
      return toDto(saved);
    } catch (error) {
      await this.markConnectFailed(ws, record.id, error);
      throw error;
    }
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
    const ensured = req.settings
      ? await this.ensureWebhooks({ ...current, settings: patch.settings }, req.credentials)
      : null;
    if (ensured) patch.settings.webhookIds = ensured.webhookIds;
    const saved = await this.store.updateConnection(ws, current.id, patch, req.version);
    if (ensured?.missing) {
      await this.store.log(ws, current.id, {
        level: 'warning',
        code: 'webhook_register_failed',
        params: {
          registered: ensured.expected - ensured.missing,
          expected: ensured.expected,
        } satisfies SyncLogParams['webhook_register_failed'],
      });
    }
    if (current.settings.pushOrders && req.settings && !req.settings.pushOrders) {
      // Push turned off: claimed orders no scan will push go back to unclaimed (not "Đang đẩy"
      // forever, lines locked); turning push on again claims them anew.
      await this.orders.releasePendingPushes(ws, PROVIDER);
    }
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

  /**
   * "Đồng bộ ngay": queues a reconcile. A connection whose connect step failed never syncs (the
   * runner closes its jobs), so it is refused with 409 `connect_failed`: the owner must disconnect
   * and connect again.
   */
  async syncNow(ws: WorkspaceId): Promise<void> {
    const current = await this.live(ws);
    if (current.lastError?.code === 'connect_failed') throw new ConnectFailedError();
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

  /**
   * Deletes the webhooks at KiotViet (best effort), disconnects, then releases the linked products
   * and the orders still waiting to be pushed.
   * The status goes first so a running job or webhook stops writing before the release; one that
   * still lands a write releases again when it sees the disconnect (`SyncService`, `WebhookApplier`).
   */
  async disconnect(ws: WorkspaceId): Promise<void> {
    const current = await this.live(ws);
    try {
      await this.webhooks.deleteAll(current, this.storedCredentials(current));
    } catch {
      this.logger.warn(`Connection ${current.id}: webhooks left at KiotViet`);
    }
    await this.store.updateConnection(ws, current.id, { status: 'disconnected' });
    await this.catalog.releaseExternalSource(ws, PROVIDER);
    // Claimed orders no job will push any more: back to unclaimed, so a later connection takes them.
    await this.orders.releasePendingPushes(ws, PROVIDER);
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async live(ws: WorkspaceId): Promise<ConnectionRecord> {
    const current = await this.store.liveConnection(ws, PROVIDER);
    if (!current) throw new ConnectionNotFoundError(PROVIDER);
    return current;
  }

  /**
   * The stored credentials. A secret that no longer opens (encryption key changed) is treated like
   * a rejected secret, so the owner gets the "update the code" path instead of a 500.
   */
  private storedCredentials(c: ConnectionRecord): KvCredentials {
    let clientSecret: string;
    try {
      clientSecret = this.secrets.open(c.clientSecretSealed);
    } catch {
      this.logger.warn(`Connection ${c.id}: the sealed client secret cannot be opened`);
      throw new KiotVietAuthError();
    }
    return { retailer: c.retailer, clientId: c.clientId, clientSecret };
  }

  /** Best effort: status `error` with the cause, so a half-made connection is not left `syncing`. */
  private async markConnectFailed(ws: WorkspaceId, id: string, error: unknown): Promise<void> {
    this.logger.warn(`Connection ${id}: connect failed after insert (${errorName(error)})`);
    try {
      await this.store.updateConnection(ws, id, {
        status: 'error',
        lastError: { code: 'connect_failed', at: new Date().toISOString() },
      });
    } catch (markError) {
      this.logger.warn(`Connection ${id}: could not mark the error (${errorName(markError)})`);
    }
  }

  /**
   * Registers the webhooks and saves each id as soon as KiotViet returns it, so a later failure
   * never leaves a webhook Rapiz cannot delete. A registration failure is logged and the periodic
   * reconcile covers it; a failure to save an id propagates. Returns the latest record.
   */
  private async registerWebhooks(
    ws: WorkspaceId,
    c: ConnectionRecord,
    creds: KvCredentials,
    secretBase64: string,
  ): Promise<ConnectionRecord> {
    let saved = c;
    const result = await this.webhooks.register(c, creds, secretBase64, async (webhookIds) => {
      saved = await this.store.updateConnection(ws, c.id, {
        settings: { ...saved.settings, webhookIds },
      });
    });
    if (result.failure) {
      this.logger.warn(`Connection ${c.id}: webhook registration failed (${result.failure})`);
      await this.store.log(ws, c.id, {
        level: 'warning',
        code: 'webhook_register_failed',
        params: {
          registered: result.registered,
          expected: result.expected,
        } satisfies SyncLogParams['webhook_register_failed'],
      });
    }
    return saved;
  }

  /**
   * The webhook set the new settings need (`order.update` follows `pushOrders`). Best effort: when
   * KiotViet cannot list them the save goes on and the next reconcile ensures the set.
   */
  private async ensureWebhooks(c: ConnectionRecord, newCredentials?: KiotVietCredentials) {
    try {
      const creds = newCredentials ? credentials(newCredentials) : this.storedCredentials(c);
      return await this.webhooks.ensure(c, creds, { interactive: true });
    } catch (error) {
      this.logger.warn(`Connection ${c.id}: webhooks not checked (${errorName(error)})`);
      return null;
    }
  }
}

/**
 * Store name from what the owner pasted, with the id and secret trimmed (the contract already
 * trims HTTP input; this keeps other callers honest).
 */
function credentials(input: KiotVietCredentials): KvCredentials {
  const retailer = parseRetailer(input.retailer);
  if (!retailer) throw new KiotVietRetailerError();
  return { retailer, clientId: input.clientId.trim(), clientSecret: input.clientSecret.trim() };
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
