import { Inject, Injectable, Logger } from '@nestjs/common';

import { SECRET_BOX, type SecretBox } from '../../../common/security/secret-box.js';
import { nextAttemptAt, shouldDisable } from '../domain/delivery-schedule.js';
import {
  type AttemptOutcome,
  DEVELOPER_SYSTEM_STORE,
  type DeveloperSystemStore,
  type DueDelivery,
} from './ports/developer-store.js';
import { WEBHOOK_TRANSPORT, type WebhookTransport } from './ports/webhook-transport.js';
import { webhookHeaders } from './webhook-signing.js';

const BATCH = 100;
/** A claimed delivery is not claimed again before this (longer than one attempt can take). */
const LEASE_MS = 60_000;

/**
 * Sends due deliveries (ADR-022 §5): signed POSTs, one endpoint's deliveries in order and
 * endpoints in parallel; retries after 1 m, 5 m, 30 m, 2 h, 6 h, 12 h and 24 h, then `failed`.
 * An endpoint failing for 3 days without one success is disabled.
 */
@Injectable()
export class WebhookSender {
  readonly #log = new Logger('WebhookSender');

  constructor(
    @Inject(DEVELOPER_SYSTEM_STORE) private readonly system: DeveloperSystemStore,
    @Inject(WEBHOOK_TRANSPORT) private readonly transport: WebhookTransport,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  /** Returns how many deliveries it attempted. */
  async send(now = new Date()): Promise<number> {
    const due = await this.system.claimDue(now, BATCH, LEASE_MS);
    // `now` moved by the real time spent, so late attempts of a slow batch sign a fresh timestamp.
    const started = Date.now();
    const clock = () => new Date(now.getTime() + Date.now() - started);
    const byEndpoint = new Map<string, DueDelivery[]>();
    for (const x of due) {
      const list = byEndpoint.get(x.endpoint.id) ?? [];
      list.push(x);
      byEndpoint.set(x.endpoint.id, list);
    }
    await Promise.all(
      [...byEndpoint.values()].map(async (list) => {
        try {
          for (const x of list) {
            if (!(await this.#attempt(x, clock))) break;
          }
        } catch {
          // E.g. a secret sealed with another key; the claim lease expires and the rest retries.
          this.#log.error(`Webhook delivery to endpoint ${list[0]?.endpoint.id ?? ''} failed`);
        }
      }),
    );
    return due.length;
  }

  /** False when the endpoint was disabled: its remaining deliveries wait for re-enabling. */
  async #attempt({ delivery, endpoint }: DueDelivery, clock: () => Date): Promise<boolean> {
    const now = clock();
    const body = JSON.stringify(delivery.payload);
    const secrets = [this.box.open(endpoint.secretEncrypted)];
    if (
      endpoint.previousSecretEncrypted &&
      endpoint.previousSecretExpiresAt &&
      endpoint.previousSecretExpiresAt > now
    ) {
      secrets.push(this.box.open(endpoint.previousSecretEncrypted));
    }
    const headers = webhookHeaders({
      eventId: delivery.eventId,
      eventType: delivery.eventType,
      secrets,
      body,
      now,
    });
    const result = await this.transport.post(endpoint.url, headers, body);
    const attempts = delivery.attempts + 1;
    const sentAt = clock();
    let outcome: AttemptOutcome;
    if (result.ok) {
      outcome = {
        status: 'succeeded',
        attempts,
        nextAttemptAt: null,
        lastStatusCode: result.status,
        lastError: null,
        deliveredAt: sentAt,
      };
    } else {
      const next = nextAttemptAt(attempts, sentAt);
      outcome = {
        status: next ? 'pending' : 'failed',
        attempts,
        nextAttemptAt: next,
        lastStatusCode: result.status,
        lastError: result.error.slice(0, 500),
        deliveredAt: null,
      };
    }
    await this.system.recordAttempt(delivery.id, outcome);
    const failingSince = await this.system.recordEndpointHealth(endpoint.id, result.ok, sentAt);
    if (!result.ok && shouldDisable(failingSince, sentAt)) {
      if (await this.system.disableFailing(endpoint.id, sentAt)) {
        // No notification channel yet: the owner sees `disabledReason: failing` in Settings.
        this.#log.warn(`Webhook endpoint ${endpoint.id} disabled after failing for 3 days`);
      }
      return false;
    }
    return true;
  }
}
