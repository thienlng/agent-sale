import { z } from 'zod';

import { SUBSCRIPTION_STATUSES } from './billing.schema.js';

/**
 * Integration events published by the billing module (ADR-021 §2). Platform-level (no workspace).
 * They carry plan facts only; consumers group by `planCode`.
 */
export const SUBSCRIPTION_CHANGE_REASONS = [
  'signup_trial',
  'admin',
  'payment',
  'expiry',
  'cancel',
  'cli',
] as const;
export type SubscriptionChangeReason = (typeof SUBSCRIPTION_CHANGE_REASONS)[number];

export const SubscriptionChangedV1 = z.object({
  type: z.literal('billing.subscription.changed.v1'),
  accountId: z.uuid(),
  planCode: z.string(),
  planVersion: z.number().int(),
  planName: z.string(),
  periodMonths: z.number().int().nullable(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  periodStart: z.iso.datetime().nullable(),
  periodEnd: z.iso.datetime().nullable(),
  /** Monthly recurring revenue in VND (`price_by_period` holds the monthly price of each term); 0 for free, trials, suspended and canceled. */
  mrrVnd: z.number().int().min(0),
  reason: z.enum(SUBSCRIPTION_CHANGE_REASONS),
  occurredAt: z.iso.datetime(),
});
export type SubscriptionChangedV1 = z.infer<typeof SubscriptionChangedV1>;

/** Daily, per account: AI reply use of the current cycle (ADR-021 §2). */
export const UsageSnapshotV1 = z.object({
  type: z.literal('billing.usage.snapshot.v1'),
  accountId: z.uuid(),
  used: z.number().int().min(0),
  limit: z.number().int().min(0),
  cycleStart: z.iso.datetime(),
  cycleEnd: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
});
export type UsageSnapshotV1 = z.infer<typeof UsageSnapshotV1>;

/** Lifecycle reminder (PR 2): the owner should act before `dueAt`. */
export const SUBSCRIPTION_REMINDER_KINDS = ['trial_ending', 'renewal_due', 'past_due'] as const;
export const SubscriptionReminderV1 = z.object({
  type: z.literal('billing.subscription.reminder.v1'),
  accountId: z.uuid(),
  kind: z.enum(SUBSCRIPTION_REMINDER_KINDS),
  daysLeft: z.number().int(),
  dueAt: z.iso.datetime(),
  occurredAt: z.iso.datetime(),
});
export type SubscriptionReminderV1 = z.infer<typeof SubscriptionReminderV1>;

export const BillingEvents = z.discriminatedUnion('type', [
  SubscriptionChangedV1,
  UsageSnapshotV1,
  SubscriptionReminderV1,
]);
export type BillingEvent = z.infer<typeof BillingEvents>;
