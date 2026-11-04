import { describe, expect, it } from 'vitest';

import {
  changesAlertState,
  type ScheduleDraftContext,
  type ScheduleDraftInput,
  validateDraft,
} from '../domain/schedule.js';

const BIZ = '018d0000-0000-7000-8000-000000000001';
const draft = (over: Partial<ScheduleDraftInput> = {}): ScheduleDraftInput => ({
  name: 'Doanh thu hôm qua',
  businessId: BIZ,
  template: 'revenue_summary',
  mode: 'report',
  params: { period: 'day', window: 'previous' },
  cadence: { kind: 'daily', at: '08:00' },
  channels: ['in_app'],
  commentary: false,
  ...over,
});
const ctx: ScheduleDraftContext = {
  businessIds: [BIZ],
  existingCount: 0,
  emailAvailable: true,
  isSafeText: (t: string) => !/https?:|\d{9,}/.test(t),
};

describe('validateDraft', () => {
  it('accepts a valid report and a valid alert', () => {
    expect(validateDraft(draft(), ctx)).toEqual([]);
    expect(
      validateDraft(
        draft({
          template: 'low_stock',
          mode: 'alert',
          params: { threshold: 5 },
          cadence: { kind: 'every', minutes: 30 },
        }),
        ctx,
      ),
    ).toEqual([]);
  });

  it('returns each problem code', () => {
    const one = (d: Partial<ScheduleDraftInput>, c: Partial<ScheduleDraftContext> = {}) =>
      validateDraft(draft(d), { ...ctx, ...c });
    expect(one({ mode: 'alert', cadence: { kind: 'every', minutes: 30 } })).toEqual([
      'invalid_mode',
    ]);
    expect(one({ cadence: { kind: 'every', minutes: 30 } })).toEqual(['interval_too_short']);
    expect(
      one({ template: 'low_stock', mode: 'alert', cadence: { kind: 'every', minutes: 45 } }),
    ).toEqual(['interval_too_short']);
    expect(one({ template: 'low_stock', mode: 'alert' })).toEqual(['alert_needs_every']);
    expect(one({}, { existingCount: 10 })).toEqual(['schedule_limit']);
    expect(one({}, { existingCount: null })).toEqual([]);
    expect(one({ businessId: '018d0000-0000-7000-8000-000000000009' })).toEqual([
      'unknown_business',
    ]);
    expect(one({ name: 'Xem https://evil.test' })).toEqual(['unsafe_name']);
    expect(one({ channels: ['in_app', 'email'] }, { emailAvailable: false })).toEqual([
      'email_unavailable',
    ]);
    expect(one({ channels: ['email'] })).toEqual(['in_app_required']);
    expect(one({ cadence: { kind: 'every', minutes: 60 } })).toEqual([]);
  });

  it('tells when an edit resets the alert state', () => {
    const a = draft({ params: { period: 'day', window: 'previous' } });
    expect(changesAlertState(a, { ...a, params: { window: 'previous', period: 'day' } })).toBe(
      false,
    );
    expect(changesAlertState(a, { ...a, params: { period: 'week', window: 'previous' } })).toBe(
      true,
    );
    expect(changesAlertState(a, { ...a, mode: 'alert' })).toBe(true);
  });
});
