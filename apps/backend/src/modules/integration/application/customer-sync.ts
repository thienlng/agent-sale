import type { SyncLogParams } from '@agent-sales/contracts';
import type { WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CONTACT_SYNC_FACADE,
  ContactExternalLinkConflictError,
  type ContactSyncFacade,
  InvalidExternalContactIdError,
} from '../../crm/api/index.js';
import {
  IntegrationUnavailableError,
  KiotVietAuthError,
  KiotVietPermissionError,
  KiotVietRetailerError,
} from '../domain/integration.errors.js';
import { contactOfKvCustomer, type KvCustomer } from '../domain/kiotviet-customer.js';
import { SOURCE } from './catalog-writer.js';
import { disableCustomerSync } from './customer-switch.js';
import {
  type ConnectionRecord,
  INTEGRATION_STORE,
  type IntegrationStore,
  type JobRecord,
} from './ports/integration-store.js';
import {
  KIOTVIET_GATEWAY,
  type KiotVietGateway,
  type KvCredentials,
} from './ports/kiotviet-gateway.js';
import { ConnectionGoneError, JOB_LEASE_MS, LeaseLostError, PAGE_SIZE } from './sync-context.js';

/** Resume point of a customer import (saved after every page). */
interface CustomerCursor {
  currentItem: number;
  /** ISO start of the import. */
  startedAt: string;
}

const isCustomerCursor = (v: unknown): v is CustomerCursor =>
  !!v &&
  typeof v === 'object' &&
  typeof (v as CustomerCursor).currentItem === 'number' &&
  typeof (v as CustomerCursor).startedAt === 'string';

/**
 * Customer sync was turned off while customer work ran (`CustomerPassHooks.live`): the work stops
 * quietly, with nothing to retry and nothing to report.
 */
export class CustomerSyncOffError extends Error {
  constructor() {
    super('Customer sync was turned off');
    this.name = 'CustomerSyncOffError';
  }
}

/** A job's liveness and heartbeat, as the job runner hands them over. */
export interface CustomerPassHooks {
  /** Throws `ConnectionGoneError` once the connection is disconnected. */
  live(): Promise<ConnectionRecord>;
  /** Extends the job lease; throws `LeaseLostError` when it is gone. */
  heartbeat(): Promise<void>;
}

/**
 * KiotViet customers → Rapiz CRM (spec §4.4, PR 3) through `CONTACT_SYNC_FACADE`: the
 * `customer_import` job (full, resumable, pages of 100), the incremental pass of each reconcile and
 * the `customer.update` / `customer.delete` webhooks. KiotViet owns a linked customer's profile
 * fields; a KiotViet delete only unlinks. Every write runs only while the connection is live and
 * `syncCustomers` is on. Logs ids and counts only (rule 07).
 */
@Injectable()
export class CustomerSync {
  private readonly logger = new Logger(CustomerSync.name);

  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(KIOTVIET_GATEWAY) private readonly gateway: KiotVietGateway,
    @Inject(CONTACT_SYNC_FACADE) private readonly contacts: ContactSyncFacade,
  ) {}

  /**
   * The full import. A fresh run first gives failed pushes another chance (the owner's way to retry
   * them). Ends with `counts.customers` and `customers_synced {count}`.
   */
  async runImport(job: JobRecord, connection: ConnectionRecord, creds: KvCredentials) {
    const ws = job.workspaceId;
    if (!connection.settings.syncCustomers) {
      await this.store.completeJob(job.id, job.claimToken);
      return;
    }
    try {
      await this.importPages(job, connection, creds);
    } catch (error) {
      if (error instanceof KiotVietPermissionError) {
        await disableCustomerSync(this.store, this.contacts, ws, connection.id);
      } else if (!(error instanceof CustomerSyncOffError)) throw error;
    }
    await this.store.completeJob(job.id, job.claimToken);
  }

  /**
   * A full import gave up after its retries (`sync_failed` / `kiotviet_unavailable`): customer
   * sync is not the connection, so its status stays and order push goes on. Logs
   * `customers_import_failed {reason}` unless the newest customer entry of the log already says so
   * (a reconcile re-queues the import while there is no customer watermark).
   */
  async importFailed(ws: WorkspaceId, connectionId: string, reason: string): Promise<void> {
    const recent = await this.store.recentLog(ws, connectionId, RECENT_LOG_SCAN);
    const last = recent.find(
      (e) => e.code === 'customers_import_failed' || e.code === 'customers_synced',
    );
    if (last?.code === 'customers_import_failed' && last.params['reason'] === reason) return;
    await this.store.log(ws, connectionId, {
      level: 'warning',
      code: 'customers_import_failed',
      params: { reason } satisfies SyncLogParams['customers_import_failed'],
    });
  }

  /**
   * A reconcile's customer pass (switch on): customers changed since the customer watermark
   * (`counts.lastCustomerSyncAt`) minus `overlapMs`. Without a watermark no full import has
   * finished yet (also a connection whose switch was on before customer sync shipped): the pass
   * queues `customer_import` instead (at most one is open). A 403 turns customer sync off; the
   * switch turned off meanwhile stops the pass; any other failure but a connection-wide one (auth,
   * store, lease, disconnect, no database) is logged and swallowed so the catalog reconcile still
   * commits, and the watermark stays, so the next pass reads the same window again.
   */
  async reconcilePass(
    creds: KvCredentials,
    hooks: CustomerPassHooks,
    overlapMs: number,
  ): Promise<void> {
    const live = await hooks.live();
    if (!live.settings.syncCustomers) return;
    const mark = live.counts.lastCustomerSyncAt ? new Date(live.counts.lastCustomerSyncAt) : null;
    if (!mark || Number.isNaN(mark.getTime())) {
      await this.store.enqueue(live.workspaceId, {
        connectionId: live.id,
        kind: 'customer_import',
      });
      return;
    }
    const startedAt = new Date();
    try {
      await this.incremental(live, creds, new Date(mark.getTime() - overlapMs), switchedOn(hooks));
      await this.updateCount(live.workspaceId, live.id, startedAt);
    } catch (error) {
      if (error instanceof CustomerSyncOffError) return;
      if (error instanceof KiotVietPermissionError) {
        await disableCustomerSync(this.store, this.contacts, live.workspaceId, live.id);
        return;
      }
      if (connectionWide(error)) throw error;
      this.logger.warn(`Connection ${live.id}: customer pass failed (${errorName(error)})`);
      await this.updateCount(live.workspaceId, live.id);
    }
  }

  /**
   * Customers changed since `since` are upserted and the ids KiotViet reports deleted are
   * unlinked. Errors propagate.
   */
  private async incremental(
    c: ConnectionRecord,
    creds: KvCredentials,
    since: Date,
    hooks: CustomerPassHooks,
  ): Promise<void> {
    const ws = c.workspaceId;
    for (let currentItem = 0; ; currentItem += PAGE_SIZE) {
      const page = await this.gateway.customers(creds, {
        currentItem,
        pageSize: PAGE_SIZE,
        lastModifiedFrom: since,
      });
      // Once per page, right before its writes: a disconnect stops at the next page.
      await hooks.live();
      await this.upsertAll(ws, page.data);
      if (page.removedIds.length) {
        await this.contacts.unlinkExternalContacts(ws, SOURCE, page.removedIds.map(String));
      }
      await hooks.heartbeat();
      // By `total`, not by an empty page: a page of malformed records parses empty.
      if (currentItem + PAGE_SIZE >= page.total) break;
    }
  }

  /**
   * `customer.update` re-reads each customer by id (never the payload): found → upsert, gone →
   * unlink; `customer.delete` unlinks. Ignored while `syncCustomers` is off.
   */
  async webhook(
    c: ConnectionRecord,
    creds: KvCredentials,
    action: 'customer.update' | 'customer.delete',
    ids: number[],
    assertLive: () => Promise<void>,
  ): Promise<void> {
    if (!c.settings.syncCustomers) return;
    const ws = c.workspaceId;
    const gone: string[] = action === 'customer.delete' ? ids.map(String) : [];
    if (action === 'customer.update') {
      const found: KvCustomer[] = [];
      for (const id of ids) {
        const customer = await this.gateway.customerById(creds, id);
        if (customer) found.push(customer);
        else gone.push(String(id));
      }
      if (found.length) {
        await assertLive();
        await this.upsertAll(ws, found);
      }
    }
    if (gone.length) {
      await assertLive();
      await this.contacts.unlinkExternalContacts(ws, SOURCE, gone);
    }
    await this.updateCount(ws, c.id);
  }

  /**
   * After a disconnect raced a running job or webhook: customers linked after the disconnect
   * released them would stay linked. Releases them again unless the business has connected again.
   */
  async releaseIfDisconnected(ws: WorkspaceId): Promise<void> {
    if (await this.store.liveConnection(ws, SOURCE)) return;
    await this.contacts.releaseExternalSource(ws, SOURCE);
  }

  /**
   * `counts.customers` = linked customers, on the latest connection row; `syncedAt` moves the
   * customer watermark. Returns the count.
   */
  async updateCount(
    ws: WorkspaceId,
    connectionId: string,
    syncedAt: Date | null = null,
  ): Promise<number> {
    const count = await this.contacts.linkedContactCount(ws, SOURCE);
    const latest = await this.store.connectionForSystem(connectionId);
    if (latest && latest.status !== 'disconnected') {
      await this.store.updateConnection(ws, connectionId, {
        counts: {
          ...latest.counts,
          customers: count,
          ...(syncedAt ? { lastCustomerSyncAt: syncedAt.toISOString() } : {}),
        },
      });
    }
    return count;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * The full import's pages: the cursor is saved after every page, the ids KiotViet reports
   * removed are unlinked (detached, never pushed back), the watermark is set to the start of the
   * import when it ends.
   */
  private async importPages(job: JobRecord, connection: ConnectionRecord, creds: KvCredentials) {
    const ws = job.workspaceId;
    const hooks = this.hooks(job, connection);
    let cursor: CustomerCursor;
    if (isCustomerCursor(job.cursor)) cursor = { ...job.cursor };
    else {
      cursor = { currentItem: 0, startedAt: new Date().toISOString() };
      await this.contacts.releaseFailedContactPushes(ws, SOURCE);
      await this.checkpoint(job, cursor);
    }
    for (;;) {
      const page = await this.gateway.customers(creds, {
        currentItem: cursor.currentItem,
        pageSize: PAGE_SIZE,
      });
      await hooks.live();
      await this.upsertAll(ws, page.data);
      if (page.removedIds.length) {
        await this.contacts.unlinkExternalContacts(ws, SOURCE, page.removedIds.map(String));
      }
      cursor.currentItem += PAGE_SIZE;
      await this.checkpoint(job, cursor);
      // By `total`, not by an empty page: a page of malformed records parses empty.
      if (cursor.currentItem >= page.total) break;
    }
    await hooks.live();
    const count = await this.updateCount(ws, connection.id, new Date(cursor.startedAt));
    await this.store.log(ws, connection.id, {
      level: 'info',
      code: 'customers_synced',
      params: { count } satisfies SyncLogParams['customers_synced'],
    });
  }

  /**
   * Upserts a page of customers (the caller re-reads the connection once per page). A record the
   * CRM refuses (bad id, its KiotViet id linked elsewhere by a race) is skipped
   * and counted in the process log.
   */
  private async upsertAll(ws: WorkspaceId, customers: KvCustomer[]) {
    let skipped = 0;
    for (const customer of customers) {
      try {
        await this.contacts.upsertExternalContact(ws, SOURCE, contactOfKvCustomer(customer));
      } catch (error) {
        if (
          !(error instanceof InvalidExternalContactIdError) &&
          !(error instanceof ContactExternalLinkConflictError)
        )
          throw error;
        skipped += 1;
      }
    }
    if (skipped) this.logger.warn(`Workspace ${ws}: ${skipped} KiotViet customers skipped`);
  }

  private hooks(job: JobRecord, connection: ConnectionRecord): CustomerPassHooks {
    return switchedOn({
      live: async () => {
        const now = await this.store.connectionForSystem(connection.id);
        if (!now || now.status === 'disconnected') throw new ConnectionGoneError();
        return now;
      },
      heartbeat: () => this.checkpoint(job, job.cursor ?? {}),
    });
  }

  private async checkpoint(job: JobRecord, cursor: object): Promise<void> {
    const saved = await this.store.saveCursor(job.id, job.claimToken, { ...cursor }, JOB_LEASE_MS);
    if (!saved) throw new LeaseLostError();
  }
}

/** Log entries read to de-duplicate `customers_import_failed`. */
const RECENT_LOG_SCAN = 50;

/** The hooks, with `live()` also throwing `CustomerSyncOffError` once the switch is off. */
function switchedOn(hooks: CustomerPassHooks): CustomerPassHooks {
  return {
    live: async () => {
      const c = await hooks.live();
      if (!c.settings.syncCustomers) throw new CustomerSyncOffError();
      return c;
    },
    heartbeat: hooks.heartbeat,
  };
}

/** Errors that concern the whole connection (or the job), never swallowed by the customer pass. */
const connectionWide = (error: unknown): boolean =>
  error instanceof KiotVietAuthError ||
  error instanceof KiotVietRetailerError ||
  error instanceof IntegrationUnavailableError ||
  error instanceof LeaseLostError ||
  error instanceof ConnectionGoneError;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : 'unknown';
