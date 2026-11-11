import { notificationStrings } from '@agent-sales/i18n/notification';
import { describe, expect, it } from 'vitest';

import { briefingTitle, impactLine, isHcmMonday } from '../application/briefing.js';
import { blankSignal } from '../domain/signal.js';
import { DEFAULT_BRAIN_SETTINGS } from '../domain/schedule.js';
import { brainHarness, OWNER, SALES, WS } from './factories/brain-harness.js';

/** 08:00 in Asia/Ho_Chi_Minh is 01:00Z. */
const AT_8 = new Date('2026-11-11T01:00:30.000Z');
const ADMIN = '0190f5c2-0000-7000-8000-0000000000b3';

function setup(withWork = true) {
  const h = brainHarness();
  h.members.push({ userId: ADMIN, role: 'admin', status: 'active', joinedAt: new Date(0) });
  if (withWork) {
    const id = '0190f5c2-0000-7000-8000-00000000d001';
    h.facts.set(id, {
      ws: WS,
      id,
      provider: 'facebook',
      status: 'open',
      contactId: null,
      customerName: 'Chị Lan',
      customerAvatarUrl: null,
      assigneeId: null,
      awaitingSince: new Date(AT_8.getTime() - 3_600_000).toISOString(),
      lastInboundAt: new Date(AT_8.getTime() - 3_600_000).toISOString(),
      followUpAt: null,
      followUpNote: '',
      lastHumanReplyAt: null,
    });
    const ready = '0190f5c2-0000-7000-8000-00000000d002';
    h.facts.set(ready, { ...h.facts.get(id)!, id: ready, awaitingSince: null });
    void h.store.saveSignal(WS, { ...blankSignal(ready, null, AT_8), stage: 'ready' });
  }
  return h;
}

describe('morning briefing', () => {
  it('notifies the owner and admins once per day at the local briefing hour', async () => {
    const h = setup();
    expect(await h.briefing.pass(AT_8)).toBe(2);
    expect(h.notified.map((n) => n.userId).sort()).toEqual([OWNER, ADMIN].sort());
    expect(h.notified.map((n) => n.userId)).not.toContain(SALES);
    const n = h.notified[0];
    expect(n).toMatchObject({
      type: 'today.briefing',
      title: 'Hôm nay: 1 chưa trả lời, 1 sắp chốt',
      target: { kind: 'path', path: '/app/today' },
      channels: ['in_app', 'push'],
      workspaceId: WS,
    });
    // Same day, later in the hour: nothing more.
    expect(await h.briefing.pass(new Date(AT_8.getTime() + 20 * 60_000))).toBe(0);
    expect(h.notified).toHaveLength(2);
    // The next day at 08:00 it runs again.
    expect(await h.briefing.pass(new Date(AT_8.getTime() + 24 * 3_600_000))).toBe(2);
  });

  it('respects the hour in Asia/Ho_Chi_Minh and a custom hour', async () => {
    const h = setup();
    // 08:00Z is 15:00 local: not the default hour.
    expect(await h.briefing.pass(new Date('2026-11-11T08:00:00.000Z'))).toBe(0);
    await h.settings.put(WS, { ...DEFAULT_BRAIN_SETTINGS, briefingHour: 15 });
    expect(await h.briefing.pass(AT_8)).toBe(0);
    expect(await h.briefing.pass(new Date('2026-11-11T08:00:00.000Z'))).toBe(2);
  });

  it('is skipped when every count is zero, and when turned off', async () => {
    const empty = setup(false);
    expect(await empty.briefing.pass(AT_8)).toBe(0);
    expect(empty.notified).toHaveLength(0);
    const off = setup();
    await off.settings.put(WS, { ...DEFAULT_BRAIN_SETTINGS, briefingEnabled: false });
    expect(await off.briefing.pass(AT_8)).toBe(0);
  });

  it('runs from the brain tick at most once a minute', async () => {
    const h = setup();
    await h.runner.tick(AT_8);
    expect(h.notified).toHaveLength(2);
    h.store.briefingDays.clear();
    await h.runner.tick(new Date(AT_8.getTime() + 15_000));
    expect(h.notified).toHaveLength(2);
    await h.runner.tick(new Date(AT_8.getTime() + 61_000));
    expect(h.notified).toHaveLength(4);
  });

  it('builds the title from the recipient locale, non-zero counts only', () => {
    const counts = {
      attention: 3,
      unanswered: 0,
      ready: 8,
      price_silent: 0,
      follow_up: 5,
      approval: 0,
      tasks: 2,
    };
    expect(briefingTitle(notificationStrings('vi'), counts)).toBe(
      'Hôm nay: 3 cần chú ý, 8 sắp chốt, 5 cần chăm lại, 2 việc đến hạn',
    );
    expect(briefingTitle(notificationStrings('en'), counts, 'en')).toBe(
      'Today: 3 need attention, 8 ready to buy, 5 to follow up, 2 tasks due',
    );
    const ones = { ...counts, attention: 1, tasks: 1 };
    expect(briefingTitle(notificationStrings('en'), ones, 'en')).toBe(
      'Today: 1 needs attention, 8 ready to buy, 5 to follow up, 1 task due',
    );
    expect(briefingTitle(notificationStrings('vi'), ones, 'vi')).toBe(
      'Hôm nay: 1 cần chú ý, 8 sắp chốt, 5 cần chăm lại, 1 việc đến hạn',
    );
  });

  it('keeps the day open when a recipient fails, and the others still get it', async () => {
    const h = setup();
    const notify = h.briefing['notifications'] as { notify: (i: unknown) => Promise<unknown> };
    const real = notify.notify.bind(notify);
    let fail = true;
    notify.notify = (i: unknown) => {
      if (fail && (i as { userId: string }).userId === OWNER) return Promise.reject(new Error('x'));
      return real(i);
    };
    expect(await h.briefing.pass(AT_8)).toBe(1);
    expect(h.notified.map((n) => n.userId)).toEqual([ADMIN]);
    expect(h.store.briefingDays.get(WS)).toBeUndefined();
    // The next tick of the hour sends to the one that failed, then the day is taken.
    fail = false;
    await h.briefing.pass(new Date(AT_8.getTime() + 60_000));
    expect(h.notified.map((n) => n.userId)).toContain(OWNER);
    expect(h.store.briefingDays.get(WS)).toBe('2026-11-11');
  });
});

describe('briefing with the care agent (ADR-031)', () => {
  /** Monday 2026-11-16, 08:00 in Asia/Ho_Chi_Minh. */
  const MONDAY_8 = new Date('2026-11-16T01:00:30.000Z');
  const impact = {
    range: '7d' as const,
    since: '2026-11-09T01:00:30.000Z',
    until: MONDAY_8.toISOString(),
    followUpsSent: 9,
    repliesReceived: 4,
    ai: { orders: 3, revenue: 1_200_000 },
    aiStaff: { orders: 1, revenue: 300_000 },
  };

  it('knows the local Monday', () => {
    expect(isHcmMonday(MONDAY_8)).toBe(true);
    // Sunday 23:30 UTC is Monday 06:30 in Asia/Ho_Chi_Minh.
    expect(isHcmMonday(new Date('2026-11-15T23:30:00Z'))).toBe(true);
    expect(isHcmMonday(AT_8)).toBe(false);
  });

  it('writes the weekly line, and nothing when the AI brought and sent nothing', () => {
    expect(impactLine(notificationStrings('vi'), impact, 'vi')).toBe(
      '7 ngày qua Rapiz đã mang lại 4 đơn · 1.500.000 ₫ (9 tin chăm sóc)',
    );
    expect(
      impactLine(
        notificationStrings('vi'),
        {
          ...impact,
          followUpsSent: 0,
          ai: { orders: 0, revenue: 0 },
          aiStaff: { orders: 0, revenue: 0 },
        },
        'vi',
      ),
    ).toBeNull();
  });

  it('counts the drafts waiting for approval and adds the impact on Monday only', async () => {
    const h = setup(false);
    let impactReads = 0;
    h.extensions.registerCare({
      approvals: async () => ({ count: 2, items: [] }),
      afterSaleDue: async () => [],
      impact: async () => {
        impactReads++;
        return impact;
      },
    });
    expect(await h.briefing.pass(AT_8)).toBe(2);
    expect(h.notified[0]?.title).toBe('Hôm nay: 2 chờ duyệt');
    expect(h.notified[0]?.body).not.toContain('7 ngày qua');
    expect(impactReads).toBe(0);
    h.notified.length = 0;
    expect(await h.briefing.pass(MONDAY_8)).toBe(2);
    expect(impactReads).toBe(1);
    expect(h.notified[0]?.body).toContain('7 ngày qua Rapiz đã mang lại 4 đơn');
    expect(h.notified[0]?.params).toMatchObject({ approval: 2, impactOrders: 4 });
  });

  it('sends the Monday impact even when every queue is empty', async () => {
    const h = setup(false);
    h.extensions.registerCare({
      approvals: async () => ({ count: 0, items: [] }),
      afterSaleDue: async () => [],
      impact: async () => impact,
    });
    expect(await h.briefing.pass(MONDAY_8)).toBe(2);
    expect(await h.briefing.pass(new Date('2026-11-17T01:00:30.000Z'))).toBe(0);
  });
});
