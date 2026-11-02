import type { UserId } from '@agent-sales/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';

import type { NotificationRunner } from '../api/notification.runner.js';
import {
  EMAIL_DAILY_CAP,
  MAX_DELIVERY_ATTEMPTS,
  NOTIFICATION_RETENTION_DAYS,
  nextAttemptAt,
  type NotificationTarget,
} from '../domain/notification.js';
import {
  NOTIFICATION_CHANNELS,
  type NotificationChannel,
} from '../domain/ports/notification-channel.port.js';
import {
  type DeliveryRecord,
  NOTIFICATION_REPOSITORY,
  type NotificationRepository,
} from '../domain/ports/notification.repository.js';
import { IDENTITY_FACADE, type IdentityFacade } from '../../identity/api/index.js';

/** Deliveries handled per tick, and how long one claim holds them. */
export const DELIVERY_BATCH = 20;
export const DELIVERY_LEASE_MS = 2 * 60_000;
const DAY_MS = 86_400_000;

/** Where the dashboard lives, for links in emails; null leaves links out. */
export const NOTIFICATION_APP_URL = Symbol('NOTIFICATION_APP_URL');

/** An error class name, safe to store (never the message: it may echo an address). */
function errorClass(e: unknown): string {
  const name = e instanceof Error ? e.constructor.name || e.name : typeof e;
  return name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 60) || 'Error';
}

/**
 * One worker pass of notification deliveries (S3-R7, S3-R8): claims due deliveries, resolves
 * the recipient through `identity`, applies the daily email cap and sends through the
 * registered channel, retrying 1, 5 and 30 minutes later before `failed`. Delivery is
 * at-least-once: a crash between a send and the status write can resend once. The attempt is
 * counted before the send, so a send that keeps crashing the worker still ends `failed`. Once a day it
 * also purges notifications older than 90 days. Logs carry ids and error classes only.
 */
@Injectable()
export class DeliveryRunner implements NotificationRunner {
  readonly #log = new Logger('NotificationDeliveryRunner');
  #purgedDay: string | null = null;

  constructor(
    @Inject(NOTIFICATION_REPOSITORY) private readonly repo: NotificationRepository,
    @Inject(NOTIFICATION_CHANNELS) private readonly channels: NotificationChannel[],
    @Inject(IDENTITY_FACADE) private readonly identity: IdentityFacade,
    @Inject(NOTIFICATION_APP_URL) private readonly appUrl: string | null,
  ) {}

  async tick(now = new Date()): Promise<number> {
    await this.#purgeDaily(now);
    const claimed = await this.repo.claimDeliveries(now, DELIVERY_BATCH, DELIVERY_LEASE_MS);
    if (claimed.length === 0) return 0;
    const notes = new Map(
      (await this.repo.notificationsForDelivery(claimed.map((d) => d.notificationId))).map((n) => [
        n.id,
        n,
      ]),
    );
    let sent = 0;
    for (const d of claimed) {
      try {
        if (await this.#deliver(d, notes.get(d.notificationId), now)) sent++;
      } catch (e) {
        // A failed status write leaves the lease to lapse; the next claim retries it.
        this.#log.error(`delivery ${d.id} bookkeeping failed (${errorClass(e)})`);
      }
    }
    return sent;
  }

  async #deliver(
    d: DeliveryRecord,
    note: { title: string; body: string; target: NotificationTarget | null } | undefined,
    now: Date,
  ): Promise<boolean> {
    const skip = (errorCode: string) =>
      this.repo.finishDelivery(d.id, { status: 'skipped', errorCode }).then(() => false);
    if (!note) return skip('notification_gone');
    const channel = this.channels.find((c) => c.kind === d.channel);
    if (!channel) return skip('channel_unavailable');
    if (!channel.available()) {
      return skip(d.channel === 'email' ? 'email_disabled' : 'channel_unavailable');
    }
    const profile = await this.identity.profile(d.userId as UserId);
    if (!profile?.email) return skip('no_recipient');
    if (d.channel === 'email') {
      const sentToday = await this.repo.countSentEmails(d.userId, new Date(now.getTime() - DAY_MS));
      if (sentToday >= EMAIL_DAILY_CAP) return skip('daily_cap');
    }
    // A lapsed `sending` lease whose attempts are used up: the earlier sends crashed the worker.
    if (d.attempts >= MAX_DELIVERY_ATTEMPTS) {
      await this.repo.finishDelivery(d.id, { status: 'failed', errorCode: 'send_interrupted' });
      return false;
    }
    const attempts = d.attempts + 1;
    await this.repo.recordAttempt(d.id, attempts);
    try {
      const res = await channel.send({
        to: profile.email,
        locale: profile.locale,
        title: note.title,
        body: note.body,
        link: this.#link(note.target),
      });
      await this.repo.finishDelivery(d.id, {
        status: 'sent',
        attempts,
        sentAt: now,
        errorCode: null,
        providerMessageId: res.providerMessageId,
      });
      return true;
    } catch (e) {
      const code = errorClass(e);
      const retryAt = nextAttemptAt(attempts, now);
      this.#log.warn(`delivery ${d.id} attempt ${attempts} failed (${code})`);
      await this.repo.finishDelivery(
        d.id,
        retryAt
          ? { status: 'queued', attempts, nextAttemptAt: retryAt, errorCode: code }
          : { status: 'failed', attempts, errorCode: code },
      );
      return false;
    }
  }

  #link(target: NotificationTarget | null): string | null {
    if (!this.appUrl) return null;
    const base = this.appUrl.replace(/\/+$/, '');
    return target?.kind === 'path' ? `${base}${target.path}` : `${base}/app`;
  }

  async #purgeDaily(now: Date): Promise<void> {
    const day = now.toISOString().slice(0, 10);
    if (this.#purgedDay === day) return;
    this.#purgedDay = day;
    try {
      await this.repo.purgeOld(new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS));
    } catch (e) {
      this.#log.error(`notification purge failed (${errorClass(e)})`);
    }
  }
}
