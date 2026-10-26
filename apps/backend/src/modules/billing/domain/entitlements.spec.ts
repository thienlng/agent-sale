import { describe, expect, it } from 'vitest';

import { limitOf, type PlanRecord, resolveEntitlements } from './entitlements.js';

const plan: PlanRecord = {
  code: 'sales_neo',
  version: 1,
  name: 'Sales Neo',
  entitlements: {
    'members.max': 30,
    'contacts.max': null,
    'feature.lazada': true,
    'feature.api_access': false,
    'ai.models.allowed': ['smart', 'pro'],
    'ai.included_messages': { amount: 7000, periodDays: 30 },
  },
};

describe('resolveEntitlements', () => {
  it('reads limits, features, models and included messages from the plan', () => {
    const e = resolveEntitlements(plan, null, []);
    expect(e.limits).toEqual({ 'members.max': 30, 'contacts.max': null });
    expect(e.features).toEqual({ 'feature.lazada': true, 'feature.api_access': false });
    expect(e.aiModels).toEqual(['smart', 'pro']);
    expect(e.aiIncludedMessages).toEqual({ amount: 7000, periodDays: 30 });
    expect(e.status).toBe('active');
  });

  it('overrides replace plan values until they expire', () => {
    const now = new Date('2026-10-24T00:00:00Z');
    const e = resolveEntitlements(
      plan,
      null,
      [
        { key: 'members.max', value: 40, expiresAt: null },
        { key: 'feature.api_access', value: true, expiresAt: new Date('2026-11-01T00:00:00Z') },
        { key: 'contacts.max', value: 10, expiresAt: new Date('2026-10-01T00:00:00Z') },
      ],
      now,
    );
    expect(e.limits['members.max']).toBe(40);
    expect(e.features['feature.api_access']).toBe(true);
    expect(e.limits['contacts.max']).toBeNull(); // the expired override no longer applies
  });

  it('unlimited is null, an undefined key is zero, and negatives clamp to zero', () => {
    const e = resolveEntitlements(plan, null, [{ key: 'media.max', value: -5, expiresAt: null }]);
    expect(limitOf(e, 'contacts.max')).toBeNull();
    expect(limitOf(e, 'channels.max')).toBe(0);
    expect(limitOf(e, 'media.max')).toBe(0);
  });
});
