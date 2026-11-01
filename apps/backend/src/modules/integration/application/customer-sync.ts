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
      if (!(error instanceof KiotVietPermissionError)) throw error;
      await disableCustomerSync(this.store, this.contacts, ws, connection.id);
    }
    await this.store.completeJob(job.id, job.claimToken);
  }

  /**
   * A reconcile's customer pass (switch on): customers changed since the customer watermark
   * (`counts.lastCustomerSyncAt`, else the previous `lastReconcileAt`) minus `overlapMs`. A 403
   * turns customer sync off; any other failure but a connection-wide one (auth, store, lease,
   * disconnect, no database) is logged and swallowed so the catalog reconcile still commits, and
   * the watermark stays (pinned at its old value), so the next pass reads the same window again.
   */
  async reconcilePass(
    start: ConnectionRecord,
    creds: KvCredentials,
    hooks: CustomerPassHooks,
    overlapMs: number,
  ): Promise<void> {
    const live = await hooks.live();
    if (!live.settings.syncCustomers) return;
    const mark = live.counts.lastCustomerSyncAt
      ? new Date(live.counts.lastCustomerSyncAt)
      : start.lastReconcileAt;
    if (!mark || Number.isNaN(mark.getTime())) return;
    const startedAt = new Date();
    try {
      await this.incremental(live, creds, new Date(mark.getTime() - overlapMs), hooks);
      await this.updateCount(live.workspaceId, live.id, startedAt);
    } catch (error) {
      if (error instanceof KiotVietPermissionError) {
        await disableCustomerSync(this.store, this.contacts, live.workspaceId, live.id);
        return;
      }
      if (connectionWide(error)) throw error;
      this.logger.warn(`Connection ${live.id}: customer pass failed (${errorName(error)})`);
      // Pin the window: without a watermark the next pass would start at the new lastReconcileAt.
      await this.updateCount(live.workspaceId, live.id, null, mark);
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
      if (page.data.length === 0 || currentItem + PAGE_SIZE >= page.total) break;
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
   * customer watermark, `keepAt` sets it only when there is none yet. Returns the count.
   */
  async updateCount(
    ws: WorkspaceId,
    connectionId: string,
    syncedAt: Date | null = null,
    keepAt: Date | null = null,
  ): Promise<number> {
    const count = await this.contacts.linkedContactCount(ws, SOURCE);
    const latest = await this.store.connectionForSystem(connectionId);
    if (latest && latest.status !== 'disconnected') {
      const mark = syncedAt ?? (latest.counts.lastCustomerSyncAt ? null : keepAt);
      await this.store.updateConnection(ws, connectionId, {
        counts: {
          ...latest.counts,
          customers: count,
          ...(mark ? { lastCustomerSyncAt: mark.toISOString() } : {}),
        },
      });
    }
    return count;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  /**
   * The full import's pages: the cursor is saved after every page, the watermark set to the start
   * of the import when it ends.
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
      cursor.currentItem += PAGE_SIZE;
      await this.checkpoint(job, cursor);
      if (page.data.length === 0 || cursor.currentItem >= page.total) break;
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
    return {
      live: async () => {
        const now = await this.store.connectionForSystem(connection.id);
        if (!now || now.status === 'disconnected') throw new ConnectionGoneError();
        return now;
      },
      heartbeat: () => this.checkpoint(job, job.cursor ?? {}),
    };
  }

  private async checkpoint(job: JobRecord, cursor: object): Promise<void> {
    const saved = await this.store.saveCursor(job.id, job.claimToken, { ...cursor }, JOB_LEASE_MS);
    if (!saved) throw new LeaseLostError();
  }
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
