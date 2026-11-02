import { describe, expect, it } from 'vitest';

import {
  hqPeriod,
  hqStage,
  hqSubscriptionFacts,
  type HqSubscriptionInput,
  reminderNote,
  sameFacts,
} from '../domain/hq-mapping.js';
import { daysBetween, historyChanged, isUpsell, planMrr } from '../domain/subscription-rules.js';

const toDate = (iso: string) => iso.slice(0, 10);
const event: HqSubscriptionInput = {
  status: 'active',
  planCode: 'pro',
  planName: 'Pro',
  periodMonths: 1,
  periodStart: '2026-11-01T00:00:00.000Z',
  periodEnd: '2026-12-01T00:00:00.000Z',
  mrrVnd: 990_000,
  occurredAt: '2026-11-02T03:00:00.000Z',
};

describe('hqStage (spec R6)', () => {
  it('maps platform statuses to HQ stages', () => {
    expect(hqStage({ status: 'trialing', planCode: 'pro', mrrVnd: 0 })).toBe('trial');
    expect(hqStage({ status: 'active', planCode: 'pro', mrrVnd: 990_000 })).toBe('active');
    expect(hqStage({ status: 'past_due', planCode: 'pro', mrrVnd: 990_000 })).toBe('past_due');
    expect(hqStage({ status: 'suspended', planCode: 'pro', mrrVnd: 990_000 })).toBe('canceled');
    expect(hqStage({ status: 'canceled', planCode: 'pro', mrrVnd: 990_000 })).toBe('canceled');
  });

  it('reads an active free plan as free, not paying', () => {
    expect(hqStage({ status: 'active', planCode: 'free', mrrVnd: 0 })).toBe('free');
    expect(hqStage({ status: 'active', planCode: 'pro', mrrVnd: 0 })).toBe('free');
  });
});

describe('hqPeriod', () => {
  it('maps months to billing periods, monthly otherwise', () => {
    expect([1, 3, 6, 12, 2].map(hqPeriod)).toEqual([
      'monthly',
      'quarterly',
      'semiannual',
      'yearly',
      'monthly',
    ]);
    expect(hqPeriod(null)).toBe('monthly');
  });
});

describe('hqSubscriptionFacts', () => {
  it('takes MRR and the renewal date of a paying subscription', () => {
    expect(hqSubscriptionFacts(event, toDate)).toEqual({
      planName: 'Pro',
      stage: 'active',
      billingPeriod: 'monthly',
      mrr: 990_000,
      trialEndsOn: null,
      startedOn: '2026-11-01',
      renewsOn: '2026-12-01',
      canceledOn: null,
    });
  });

  it('gives a trial its end date, falling back to the event date', () => {
    const trial = hqSubscriptionFacts({ ...event, status: 'trialing', mrrVnd: 0 }, toDate);
    expect(trial).toMatchObject({ stage: 'trial', trialEndsOn: '2026-12-01', mrr: 0 });
    expect(trial.renewsOn).toBeNull();
    expect(
      hqSubscriptionFacts({ ...event, status: 'trialing', periodEnd: null }, toDate).trialEndsOn,
    ).toBe('2026-11-02');
  });

  it('dates a cancellation on the event and drops MRR', () => {
    expect(hqSubscriptionFacts({ ...event, status: 'suspended' }, toDate)).toMatchObject({
      stage: 'canceled',
      mrr: 0,
      renewsOn: null,
      canceledOn: '2026-11-02',
    });
  });

  it('compares facts field by field', () => {
    const a = hqSubscriptionFacts(event, toDate);
    expect(sameFacts(a, { ...a })).toBe(true);
    expect(sameFacts(a, { ...a, mrr: 1 })).toBe(false);
    // A stored row carries more fields than the facts: only the synced ones count.
    const stored = { ...a, id: 'row', seats: 3, version: 7 };
    expect(sameFacts(stored, a)).toBe(true);
  });
});

describe('reminderNote', () => {
  it('says how many days are left, today, or how late', () => {
    expect(reminderNote('trial_ending', '2026-11-05', 3)).toContain('còn 3 ngày');
    expect(reminderNote('renewal_due', '2026-11-02', 0)).toContain('hôm nay');
    expect(reminderNote('past_due', '2026-10-30', -3)).toContain('quá 3 ngày');
  });
});

describe('subscription rules', () => {
  it('computes MRR from the period price', () => {
    const prices = { monthly: 990_000, yearly: 9_900_000, semiannual: 5_000_000 };
    expect(planMrr(prices, 'monthly')).toBe(990_000);
    expect(planMrr(prices, 'yearly')).toBe(825_000);
    expect(planMrr(prices, 'semiannual')).toBe(833_333);
    expect(planMrr(prices, 'quarterly')).toBeNull();
  });

  it('flags an upsell from 80% of the allowance', () => {
    expect(isUpsell({ used: 80, limit: 100, at: 'x' })).toBe(true);
    expect(isUpsell({ used: 79, limit: 100, at: 'x' })).toBe(false);
    expect(isUpsell({ used: 5, limit: 0, at: 'x' })).toBe(false);
    expect(isUpsell(null)).toBe(false);
  });

  it('adds a history row only when stage, plan or MRR changed', () => {
    const f = { stage: 'active' as const, planName: 'Pro', mrr: 1 };
    expect(historyChanged(null, f)).toBe(true);
    expect(historyChanged(f, { ...f })).toBe(false);
    expect(historyChanged(f, { ...f, planName: 'Max' })).toBe(true);
    expect(historyChanged(f, { ...f, stage: 'past_due' })).toBe(true);
  });

  it('counts calendar days', () => {
    expect(daysBetween('2026-11-02', '2026-11-05')).toBe(3);
    expect(daysBetween('2026-11-05', '2026-11-02')).toBe(-3);
  });
});
