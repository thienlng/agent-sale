import { describe, expect, it } from 'vitest';

import {
  ALERT_TEMPLATES,
  Cadence,
  ScheduleDraft,
  SchedulePatch,
  scheduleParamsSchema,
} from './schedule.schema.js';

const draft = {
  name: 'Doanh thu tuần trước',
  businessId: '018d0000-0000-7000-8000-000000000001',
  template: 'revenue_summary',
  mode: 'report',
  params: { period: 'week', window: 'previous' },
  cadence: { kind: 'weekly', days: [1], at: '08:00' },
  channels: ['in_app', 'email'],
};

describe('ScheduleDraft', () => {
  it('accepts a weekly revenue report and fills the defaults', () => {
    const parsed = ScheduleDraft.parse(draft);
    expect(parsed.commentary).toBe(false);
    expect(scheduleParamsSchema('low_stock', 'alert').parse({})).toEqual({ threshold: 5 });
    expect(scheduleParamsSchema('unanswered_conversations', 'alert').parse({})).toEqual({
      minutes: 30,
      minCount: 1,
    });
  });

  it('accepts new_requests as a report and as an alert (T-187)', () => {
    expect(ALERT_TEMPLATES).toContain('new_requests');
    const alert = ScheduleDraft.parse({
      ...draft,
      template: 'new_requests',
      mode: 'alert',
      params: {},
      cadence: { kind: 'every', minutes: 30 },
    });
    expect(alert.params).toEqual({});
    expect(scheduleParamsSchema('new_requests', 'alert').parse({})).toEqual({ minCount: 1 });
    expect(scheduleParamsSchema('new_requests', 'alert').safeParse({ minCount: 0 }).success).toBe(
      false,
    );
    expect(
      scheduleParamsSchema('new_requests', 'alert').safeParse({ minCount: 1001 }).success,
    ).toBe(false);
    expect(scheduleParamsSchema('new_requests', 'report').parse({})).toEqual({
      period: 'day',
      window: 'previous',
    });
    expect(
      ScheduleDraft.safeParse({ ...draft, template: 'new_requests', params: { period: 'year' } })
        .success,
    ).toBe(false);
  });

  it('validates the params of the template', () => {
    expect(ScheduleDraft.safeParse({ ...draft, params: { period: 'year' } }).success).toBe(false);
    expect(
      ScheduleDraft.safeParse({
        ...draft,
        template: 'low_stock',
        params: { threshold: -1 },
      }).success,
    ).toBe(false);
  });

  it('checks the cadence shape', () => {
    expect(Cadence.safeParse({ kind: 'daily', at: '24:00' }).success).toBe(false);
    expect(Cadence.safeParse({ kind: 'weekly', days: [1, 1], at: '08:00' }).success).toBe(false);
    expect(Cadence.safeParse({ kind: 'weekly', days: [], at: '08:00' }).success).toBe(false);
    expect(Cadence.safeParse({ kind: 'monthly', day: 29, at: '08:00' }).success).toBe(false);
    expect(Cadence.safeParse({ kind: 'monthly', day: -1, at: '08:00' }).success).toBe(true);
    expect(Cadence.safeParse({ kind: 'every', minutes: 10 }).success).toBe(false);
  });

  it('refuses an empty patch', () => {
    expect(SchedulePatch.safeParse({}).success).toBe(false);
    expect(SchedulePatch.safeParse({ name: 'Mới' }).success).toBe(true);
  });
});
