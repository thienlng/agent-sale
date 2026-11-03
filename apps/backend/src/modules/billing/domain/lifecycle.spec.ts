import { describe, expect, it } from 'vitest';

import {
  dueReminder,
  type LifecycleSubscription,
  nextLifecycleStep,
  trialEnded,
} from './lifecycle.js';

const now = new Date('2026-11-10T00:00:00Z');
const day = 86_400_000;
const at = (days: number) => new Date(now.getTime() + days * day);
const settings = { afterTrialPlanCode: 'free', graceDays: 7, suspendDays: 30 };
const sub = (over: Partial<LifecycleSubscription>): LifecycleSubscription => ({
  planCode: 'sales_pro',
  status: 'active',
  periodMonths: 3,
  currentPeriodEnd: at(10),
  statusChangedAt: at(-60),
  remindersSent: {},
  ...over,
});

describe('nextLifecycleStep', () => {
  it('ends a trial on the plan after the trial', () => {
    const trial = sub({ status: 'trialing', periodMonths: null, currentPeriodEnd: at(-1) });
    expect(nextLifecycleStep(trial, settings, now)).toEqual({
      kind: 'trial_ended',
      planCode: 'free',
    });
    expect(trialEnded(trial, now)).toBe(true);
    expect(nextLifecycleStep({ ...trial, currentPeriodEnd: at(1) }, settings, now)).toBeNull();
  });

  it('moves an unpaid period to past due, then suspended, then free', () => {
    expect(nextLifecycleStep(sub({ currentPeriodEnd: at(-1) }), settings, now)).toEqual({
      kind: 'past_due',
    });
    expect(nextLifecycleStep(sub({ currentPeriodEnd: at(1) }), settings, now)).toBeNull();
    expect(
      nextLifecycleStep(sub({ status: 'past_due', statusChangedAt: at(-8) }), settings, now),
    ).toEqual({ kind: 'suspended' });
    expect(
      nextLifecycleStep(sub({ status: 'past_due', statusChangedAt: at(-6) }), settings, now),
    ).toBeNull();
    expect(
      nextLifecycleStep(sub({ status: 'suspended', statusChangedAt: at(-31) }), settings, now),
    ).toEqual({ kind: 'downgraded', planCode: 'free' });
  });

  it('leaves the free plan (no period) alone', () => {
    expect(
      nextLifecycleStep(sub({ periodMonths: null, currentPeriodEnd: null }), settings, now),
    ).toBeNull();
  });
});

describe('dueReminder', () => {
  it('reminds a trial 3 and 1 days before its end, once each', () => {
    const trial = sub({ status: 'trialing', periodMonths: null, currentPeriodEnd: at(2.5) });
    expect(dueReminder(trial, now)).toMatchObject({
      kind: 'trial_ending',
      keys: ['trial_ending:3'],
      daysLeft: 3,
    });
    expect(dueReminder({ ...trial, remindersSent: { 'trial_ending:3': 'x' } }, now)).toBeNull();
    expect(dueReminder({ ...trial, currentPeriodEnd: at(5) }, now)).toBeNull();
  });

  it('covers skipped thresholds when the job runs late', () => {
    expect(dueReminder(sub({ currentPeriodEnd: at(0.5) }), now)).toMatchObject({
      kind: 'renewal_due',
      keys: ['renewal_due:7', 'renewal_due:1'],
    });
  });

  it('sends one past-due reminder', () => {
    const late = sub({ status: 'past_due', currentPeriodEnd: at(-1) });
    expect(dueReminder(late, now)).toMatchObject({ kind: 'past_due', keys: ['past_due'] });
    expect(dueReminder({ ...late, remindersSent: { past_due: 'x' } }, now)).toBeNull();
  });
});
