import { Inject, Injectable, Logger } from '@nestjs/common';

import type { IntegrationRunner } from '../api/integration.runner.js';
import { IntegrationUnavailableError } from '../domain/integration.errors.js';
import { CONTACT_PUSH_SCAN_MS, ContactPusher } from './contact-push.js';
import { OrderPusher, PUSH_SCAN_MS } from './order-push.js';
import { INTEGRATION_STORE, type IntegrationStore } from './ports/integration-store.js';
import { JOB_LEASE_MS } from './sync-context.js';
import { SyncService } from './sync.service.js';
import { WebhookApplier } from './webhook-apply.js';

const RECONCILE_SCAN_MS = 60_000;
const RECONCILE_EVERY_MS = 10 * 60_000;
const JOBS_PER_TICK = 5;
const WEBHOOKS_PER_TICK = 50;

/**
 * The worker's integration tick (spec §4.2, §4.4, §7): queues due reconciles once a minute, claims
 * orders to push every 15 s (one `push_order` job each) and customers to push every 30 s (one
 * `customer_import` job each), runs up to 5 claimed jobs one after the other, then applies up to
 * 50 webhook deliveries. Without a database it does nothing.
 */
@Injectable()
export class SyncRunner implements IntegrationRunner {
  private readonly logger = new Logger(SyncRunner.name);
  private lastScan = 0;
  private lastPushScan = 0;
  private lastContactScan = 0;

  constructor(
    @Inject(INTEGRATION_STORE) private readonly store: IntegrationStore,
    @Inject(SyncService) private readonly sync: SyncService,
    @Inject(WebhookApplier) private readonly webhooks: WebhookApplier,
    @Inject(OrderPusher) private readonly pusher: OrderPusher,
    @Inject(ContactPusher) private readonly contacts: ContactPusher,
  ) {}

  async tick(): Promise<void> {
    try {
      await this.scheduleReconciles();
      await this.schedulePushes();
      await this.scheduleContactPushes();
      for (const job of await this.store.claimJobs(JOBS_PER_TICK, JOB_LEASE_MS)) {
        await this.sync.runJob(job);
      }
      for (const event of await this.store.claimWebhookEvents(WEBHOOKS_PER_TICK)) {
        await this.webhooks.apply(event);
      }
    } catch (error) {
      if (error instanceof IntegrationUnavailableError) return;
      throw error;
    }
  }

  private async schedulePushes(): Promise<void> {
    const now = Date.now();
    if (now - this.lastPushScan < PUSH_SCAN_MS) return;
    this.lastPushScan = now;
    await this.pusher.scan();
  }

  private async scheduleContactPushes(): Promise<void> {
    const now = Date.now();
    if (now - this.lastContactScan < CONTACT_PUSH_SCAN_MS) return;
    this.lastContactScan = now;
    await this.contacts.scan();
  }

  private async scheduleReconciles(): Promise<void> {
    const now = Date.now();
    if (now - this.lastScan < RECONCILE_SCAN_MS) return;
    this.lastScan = now;
    const due = await this.store.connectionsDueForReconcile(new Date(now - RECONCILE_EVERY_MS));
    for (const { workspaceId, connectionId } of due) {
      // False when a sync is already open for the connection: nothing to add.
      const queued = await this.store.enqueue(workspaceId, { connectionId, kind: 'reconcile' });
      if (queued) this.logger.debug(`Connection ${connectionId}: reconcile queued`);
    }
  }
}
