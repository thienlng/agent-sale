import { Inject, Injectable, Logger } from '@nestjs/common';

import type { BillingRunner } from '../../api/billing-admin.facade.js';
import { FREE_PLAN } from '../../domain/entitlements.js';
import { dueReminder, nextLifecycleStep, type LifecycleStep } from '../../domain/lifecycle.js';
import { BillingCatalog } from '../billing-catalog.js';
import { BillingService } from '../billing.service.js';
import {
  type AccountSubscriptionRow,
  BILLING_ADMIN_STORE,
  type BillingAdminStore,
  type BillingSettings,
  type SubscriptionChange,
} from '../ports/billing-admin-store.js';

/** The worker ticks every 2 s; the lifecycle pass runs at most this often. */
const LIFECYCLE_EVERY_MS = 5 * 60_000;
/** Reminders look this far ahead (the earliest threshold: renewal 7 days before). */
const HORIZON_DAYS = 7;
const BATCH = 500;
/** Vietnam is UTC+7 all year: the snapshot day starts at 00:00 local time. */
const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

const JOB = { actorUserId: null, actorName: 'system', reason: 'subscription lifecycle' };

/** The start (UTC instant) of the Vietnamese day containing `now`. */
export function vnDayStart(now: Date): Date {
  const local = now.getTime() + VN_OFFSET_MS;
  return new Date(local - (local % DAY_MS) - VN_OFFSET_MS);
}

/**
 * Subscription lifecycle (ADR-021, spec §6.2): moves subscriptions along (trial end, past due,
 * suspension, back to free), sends reminders, and writes the daily usage snapshot. Every step
 * re-checks the row inside its transaction, so concurrent workers and reruns are harmless.
 */
@Injectable()
export class BillingLifecycleRunner implements BillingRunner {
  readonly #log = new Logger(BillingLifecycleRunner.name);
  #lastRun = 0;
  #snapshotDay = 0;

  constructor(
    @Inject(BILLING_ADMIN_STORE) private readonly store: BillingAdminStore,
    @Inject(BillingCatalog) private readonly catalog: BillingCatalog,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  async tick(now: Date = new Date()): Promise<void> {
    if (now.getTime() - this.#lastRun < LIFECYCLE_EVERY_MS) return;
    this.#lastRun = now.getTime();
    await this.runLifecycle(now);
    await this.runUsageSnapshot(now);
  }

  /** One pass over the due subscriptions. Returns the number of transitions and reminders. */
  async runLifecycle(now: Date): Promise<{ transitions: number; reminders: number }> {
    const settings = await this.store.settings();
    const rows = await this.store.lifecycleCandidates(now, HORIZON_DAYS, BATCH);
    let transitions = 0;
    let reminders = 0;
    for (const row of rows) {
      try {
        if (await this.#advance(row, settings, now)) transitions += 1;
        else if (await this.#remind(row, now)) reminders += 1;
      } catch {
        this.#log.error(`Account ${row.accountId}: lifecycle step failed`);
      }
    }
    if (transitions || reminders) {
      this.#log.log(`Billing lifecycle: ${transitions} transitions, ${reminders} reminders`);
    }
    return { transitions, reminders };
  }

  /** Once per Vietnamese day: the AI reply use of every active account. */
  async runUsageSnapshot(now: Date): Promise<boolean> {
    const day = vnDayStart(now);
    if (this.#snapshotDay === day.getTime()) return false;
    if (await this.store.snapshotWritten(day)) {
      this.#snapshotDay = day.getTime();
      return false;
    }
    const payloads: Record<string, unknown>[] = [];
    let after: string | null = null;
    for (;;) {
      const ids = await this.store.activeAccountIds(after, BATCH);
      for (const accountId of ids) {
        try {
          const a = await this.billing.accountAllowance(accountId, now);
          payloads.push({
            type: 'billing.usage.snapshot.v1',
            accountId,
            used: a.used,
            limit: a.limit,
            cycleStart: a.cycleStart.toISOString(),
            cycleEnd: a.cycleEnd.toISOString(),
            occurredAt: now.toISOString(),
          });
        } catch {
          this.#log.error(`Account ${accountId}: usage snapshot failed`);
        }
      }
      if (ids.length < BATCH) break;
      after = ids.at(-1) ?? null;
    }
    const written = await this.store.writeUsageSnapshots(day, payloads);
    this.#snapshotDay = day.getTime();
    if (written) this.#log.log(`Billing usage snapshot: ${payloads.length} accounts`);
    return written;
  }

  async #advance(row: AccountSubscriptionRow, settings: BillingSettings, now: Date) {
    const step = nextLifecycleStep(row, settings, now);
    if (!step) return false;
    const target =
      step.kind === 'trial_ended' || step.kind === 'downgraded'
        ? ((await this.catalog.latest(step.planCode)) ??
          (await this.catalog.latest(FREE_PLAN.code)))
        : null;
    const saved = await this.store.changeSubscription({
      accountId: row.accountId,
      expectedVersion: 'any',
      // Re-decided on the locked row: an operator may have changed it since the candidate scan.
      next: (current) => {
        if (!current) return null;
        const again = nextLifecycleStep(current, settings, now);
        return again?.kind === step.kind ? transition(current, again, target, now) : null;
      },
      reason: 'expiry',
      action: JOB,
    });
    return saved !== null;
  }

  async #remind(row: AccountSubscriptionRow, now: Date) {
    const reminder = dueReminder(row, now);
    if (!reminder) return false;
    return this.store.sendReminder(row.accountId, reminder.keys, {
      type: 'billing.subscription.reminder.v1',
      accountId: row.accountId,
      kind: reminder.kind,
      daysLeft: reminder.daysLeft,
      dueAt: reminder.dueAt.toISOString(),
      occurredAt: now.toISOString(),
    });
  }
}

function transition(
  current: AccountSubscriptionRow,
  step: NonNullable<LifecycleStep>,
  target: { code: string; version: number } | null,
  now: Date,
): SubscriptionChange {
  switch (step.kind) {
    case 'past_due':
    case 'suspended':
      return {
        planCode: current.planCode,
        planVersion: current.planVersion,
        periodMonths: current.periodMonths,
        status: step.kind,
        currentPeriodStart: current.currentPeriodStart,
        currentPeriodEnd: current.currentPeriodEnd,
      };
    case 'trial_ended':
    case 'downgraded': {
      // A trial ends at its end date (the lazy expiry resolved it from there); free starts now.
      const start = step.kind === 'trial_ended' ? (current.currentPeriodEnd ?? now) : now;
      return {
        planCode: target?.code ?? FREE_PLAN.code,
        planVersion: target?.version ?? FREE_PLAN.version,
        periodMonths: null,
        status: 'active',
        currentPeriodStart: start,
        currentPeriodEnd: null,
        cycleAnchor: start,
      };
    }
  }
}
