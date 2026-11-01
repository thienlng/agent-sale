import type { SyncLogParams } from '@agent-sales/contracts';
import { DomainError, normalizeAnyPhone, type WorkspaceId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  CONTACT_SYNC_FACADE,
  ContactAlreadyLinkedError,
  ContactExternalLinkConflictError,
  type ContactSyncFacade,
} from '../../crm/api/index.js';
import {
  IntegrationUnavailableError,
  KiotVietRejectedError,
} from '../domain/integration.errors.js';
import {
  kiotVietCustomerBody,
  kiotVietPhone,
  matchesPhone,
  type PushCustomer,
} from '../domain/kiotviet-customer.js';
import { SOURCE } from './catalog-writer.js';
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
import { JOB_LEASE_MS, LeaseLostError } from './sync-context.js';

/** How often the runner claims customers to push (spec §4.4). */
export const CONTACT_PUSH_SCAN_MS = 30_000;
/** Customers claimed per connection and scan. */
const CONTACT_PUSH_BATCH = 20;
/** A pending customer whose claim is older than this lost its job (crash between claim and enqueue). */
const STALE_CONTACT_MS = 2 * 60_000;

/** A `customer_import` job that pushes one customer (`payload.contactId`) rather than importing. */
export const isContactPush = (job: JobRecord): boolean =>
  job.kind === 'customer_import' && typeof job.payload['contactId'] === 'string';

/**
 * Rapiz customers → KiotViet customers (spec §4.4, PR 3), and the KiotViet customer of an order
 * push. The phone is the idempotency key: every attempt first looks KiotViet up by phone and adopts
 * the customer found, so a retry after a lost `POST /customers` answer never creates a second one.
 * Logs reasons and counts only, never customer data (rule 07).
 */
@Injectable()
export class ContactPusher {
  private readonly logger = new Logger(ContactPusher.name);

  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(KIOTVIET_GATEWAY) private readonly gateway: KiotVietGateway,
    @Inject(CONTACT_SYNC_FACADE) private readonly contacts: ContactSyncFacade,
  ) {}

  /**
   * Every 30 s: claims new customers (created since the connection) of each connection syncing
   * customers and queues one push job each, plus pending ones whose job was lost. A connection with
   * the switch off releases its claims older than 2 min instead.
   */
  async scan(): Promise<void> {
    for (const c of await this.store.connectionsForPushScan()) {
      try {
        const ws = c.workspaceId;
        const staleBefore = new Date(Date.now() - STALE_CONTACT_MS);
        if (!c.syncCustomers) {
          await this.contacts.releasePendingContactPushes(ws, SOURCE, staleBefore);
          continue;
        }
        const claimed = await this.contacts.claimContactsForPush(
          ws,
          SOURCE,
          c.createdAt,
          CONTACT_PUSH_BATCH,
        );
        const stale = await this.contacts.staleContactPushes(
          ws,
          SOURCE,
          c.createdAt,
          staleBefore,
          CONTACT_PUSH_BATCH,
        );
        for (const contactId of new Set([...claimed.map((x) => x.id), ...stale])) {
          // False while the customer's job is still open (waiting for a retry): nothing to add.
          await this.store.enqueue(ws, {
            connectionId: c.connectionId,
            kind: 'customer_import',
            payload: { contactId },
          });
        }
      } catch (error) {
        if (error instanceof IntegrationUnavailableError) throw error;
        this.logger.warn(
          `Connection ${c.connectionId}: customer push scan failed (${errorName(error)})`,
        );
      }
    }
  }

  /**
   * One push job: adopts the KiotViet customer with the same phone, else creates one in the order
   * branch, then links it. Problems of the customer itself end the job here (rejected, linked
   * elsewhere); KiotViet errors propagate to the shared retry path of `SyncService`.
   */
  async run(job: JobRecord, connection: ConnectionRecord, creds: KvCredentials): Promise<void> {
    const ws = job.workspaceId;
    const contactId = contactIdOf(job);
    const contact = connection.settings.syncCustomers
      ? await this.contacts.pushableContact(ws, SOURCE, contactId)
      : null;
    if (!contact) {
      // Pushed, released, linked or archived meanwhile, or the switch is off: nothing to do.
      await this.complete(job);
      return;
    }
    let externalId: number;
    try {
      externalId = await this.findOrCreate(job, creds, contact, connection.settings.orderBranchId);
    } catch (error) {
      if (!(error instanceof KiotVietRejectedError)) throw error;
      await this.fail(ws, connection.id, contactId, 'kiotviet_rejected');
      await this.complete(job);
      return;
    }
    try {
      await this.contacts.markContactPushed(ws, contactId, SOURCE, String(externalId));
    } catch (error) {
      if (error instanceof ContactExternalLinkConflictError) {
        // Another Rapiz customer is linked to that KiotViet customer (same phone twice in Rapiz).
        await this.fail(ws, connection.id, contactId, 'link_conflict');
        await this.complete(job);
        return;
      }
      const done =
        error instanceof ContactAlreadyLinkedError ||
        (error instanceof DomainError && error.code === 'NOT_FOUND');
      if (!done) throw error;
    }
    await this.updateCount(ws, connection.id);
    await this.complete(job);
  }

  /**
   * The job gave up (`auth_failed`, `kiotviet_unavailable`, `sync_failed`): the customer is marked
   * failed (a full import or turning the switch on again retries it) and the reason is logged.
   */
  async abandon(job: JobRecord, reason: string): Promise<void> {
    await this.fail(job.workspaceId, job.connectionId, contactIdOf(job), reason);
  }

  /**
   * The KiotViet customer an order push names (`customerId`), only while `syncCustomers` is on:
   * the one with the buyer's phone, else a new one. Null without a usable phone or on any failure,
   * so the order goes with the inline customer instead: a customer problem never blocks an order.
   */
  async customerIdForOrder(
    connection: ConnectionRecord,
    creds: KvCredentials,
    buyer: { name: string; phone: string | null },
  ): Promise<number | null> {
    if (!connection.settings.syncCustomers) return null;
    const phoneE164 = buyer.phone ? normalizeAnyPhone(buyer.phone) : null;
    if (!phoneE164) return null;
    try {
      const found = await this.lookup(creds, phoneE164);
      if (found !== null) return found;
      const created = await this.gateway.createCustomer(
        creds,
        kiotVietCustomerBody(
          { name: buyer.name, phoneE164, email: null, address: null },
          connection.settings.orderBranchId,
        ),
      );
      return created.id;
    } catch (error) {
      if (error instanceof IntegrationUnavailableError) throw error;
      this.logger.warn(
        `Connection ${connection.id}: order customer not resolved (${errorName(error)})`,
      );
      return null;
    }
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async findOrCreate(
    job: JobRecord,
    creds: KvCredentials,
    contact: PushCustomer,
    branchId: number,
  ): Promise<number> {
    const found = await this.lookup(creds, contact.phoneE164);
    if (found !== null) return found;
    // Heartbeat before the write that must not be sent twice: a lost lease stops here.
    const saved = await this.store.saveCursor(
      job.id,
      job.claimToken,
      { created: true },
      JOB_LEASE_MS,
    );
    if (!saved) throw new LeaseLostError();
    return (await this.gateway.createCustomer(creds, kiotVietCustomerBody(contact, branchId))).id;
  }

  /** The oldest KiotViet customer with exactly this number (KiotViet's filter may match loosely). */
  private async lookup(creds: KvCredentials, phoneE164: string): Promise<number | null> {
    const hits = (await this.gateway.customersByPhone(creds, kiotVietPhone(phoneE164)))
      .filter((c) => matchesPhone(c.contactNumber, phoneE164))
      .map((c) => c.id)
      .sort((a, b) => a - b);
    return hits[0] ?? null;
  }

  private async fail(ws: WorkspaceId, connectionId: string, contactId: string, reason: string) {
    await this.contacts.markContactPushFailed(ws, contactId, reason);
    await this.store.log(ws, connectionId, {
      level: 'warning',
      code: 'customer_push_failed',
      params: { reason } satisfies SyncLogParams['customer_push_failed'],
    });
  }

  private async updateCount(ws: WorkspaceId, connectionId: string): Promise<void> {
    const count = await this.contacts.linkedContactCount(ws, SOURCE);
    const latest = await this.store.connectionForSystem(connectionId);
    if (!latest || latest.status === 'disconnected') return;
    await this.store.updateConnection(ws, connectionId, {
      counts: { ...latest.counts, customers: count },
    });
  }

  private async complete(job: JobRecord): Promise<void> {
    await this.store.completeJob(job.id, job.claimToken);
  }
}

const contactIdOf = (job: JobRecord): string => String(job.payload['contactId'] ?? '');

const errorName = (error: unknown): string =>
  error instanceof Error ? error.constructor.name : 'unknown';
