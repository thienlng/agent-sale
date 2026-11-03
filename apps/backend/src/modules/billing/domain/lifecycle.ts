import { addDays, DAY_MS } from './plan-catalog.js';

/**
 * Subscription lifecycle (ADR-021, spec §6.2). The worker moves account subscriptions along:
 *
 * - `trialing`, trial over → the plan after the trial (default `free`), `active`, no period;
 * - `active` paid period over → `past_due` (the bot keeps answering);
 * - `past_due` for more than `graceDays` → `suspended` (the bot hands every conversation off);
 * - `suspended` for more than `suspendDays` → the free plan, `active`.
 *
 * Reads never wait for the worker: a trial that ended resolves to the plan after the trial at once
 * (`effectivePlanOf`).
 */
export interface LifecycleSubscription {
  planCode: string;
  status: string;
  periodMonths: number | null;
  currentPeriodEnd: Date | null;
  statusChangedAt: Date;
  remindersSent: Record<string, string>;
}

export interface LifecycleSettings {
  afterTrialPlanCode: string;
  graceDays: number;
  suspendDays: number;
}

export type LifecycleStep =
  | { kind: 'trial_ended'; planCode: string }
  | { kind: 'past_due' }
  | { kind: 'suspended' }
  | { kind: 'downgraded'; planCode: string }
  | null;

const ended = (end: Date | null, now: Date) => end !== null && end.getTime() <= now.getTime();

/** The transition due now, if any. One step per run: the next run takes the next one. */
export function nextLifecycleStep(
  sub: LifecycleSubscription,
  settings: LifecycleSettings,
  now: Date,
): LifecycleStep {
  switch (sub.status) {
    case 'trialing':
      return ended(sub.currentPeriodEnd, now)
        ? { kind: 'trial_ended', planCode: settings.afterTrialPlanCode }
        : null;
    case 'active':
      return sub.periodMonths !== null && ended(sub.currentPeriodEnd, now)
        ? { kind: 'past_due' }
        : null;
    case 'past_due':
      return ended(addDays(sub.statusChangedAt, settings.graceDays), now)
        ? { kind: 'suspended' }
        : null;
    case 'suspended':
      return ended(addDays(sub.statusChangedAt, settings.suspendDays), now)
        ? { kind: 'downgraded', planCode: 'free' }
        : null;
    default:
      return null;
  }
}

/** Lazy trial expiry: an ended trial already gets the plan after the trial. */
export function trialEnded(
  sub: { status: string; currentPeriodEnd: Date | null },
  now: Date,
): boolean {
  return sub.status === 'trialing' && ended(sub.currentPeriodEnd, now);
}

export type ReminderKind = 'trial_ending' | 'renewal_due' | 'past_due';

/** Days before the end of a trial / a paid period when the owner is reminded. */
const THRESHOLDS: Record<'trial_ending' | 'renewal_due', readonly number[]> = {
  trial_ending: [3, 1],
  renewal_due: [7, 1],
};

export interface Reminder {
  kind: ReminderKind;
  /** The `reminders_sent` keys this reminder covers (a late run covers the skipped thresholds). */
  keys: string[];
  daysLeft: number;
  dueAt: Date;
}

/**
 * The reminder due now, if not already sent for the current period. `reminders_sent` is reset
 * whenever the period changes, so each threshold fires once per period.
 */
export function dueReminder(sub: LifecycleSubscription, now: Date): Reminder | null {
  const sent = (key: string) => key in sub.remindersSent;
  if (sub.status === 'past_due') {
    if (sent('past_due') || !sub.currentPeriodEnd) return null;
    return { kind: 'past_due', keys: ['past_due'], daysLeft: 0, dueAt: sub.currentPeriodEnd };
  }
  const kind =
    sub.status === 'trialing'
      ? 'trial_ending'
      : sub.status === 'active' && sub.periodMonths !== null
        ? 'renewal_due'
        : null;
  const end = sub.currentPeriodEnd;
  if (!kind || !end || ended(end, now)) return null;
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / DAY_MS);
  const keys = THRESHOLDS[kind].filter((d) => daysLeft <= d).map((d) => `${kind}:${d}`);
  if (!keys.length || keys.every(sent)) return null;
  return { kind, keys, daysLeft, dueAt: end };
}
