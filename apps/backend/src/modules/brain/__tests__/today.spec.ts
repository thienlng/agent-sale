import type { TaskDto, TodayConversationQueue, TodayResponse } from '@agent-sales/contracts';
import { describe, expect, it } from 'vitest';

import { blankSignal, type ConversationSignal } from '../domain/signal.js';
import type { TodayFacts } from '../domain/today.js';
import { DEFAULT_BRAIN_SETTINGS } from '../domain/schedule.js';
import {
  answer,
  brainHarness,
  conversation,
  OTHER_WS,
  OWNER,
  SALES,
  WS,
} from './factories/brain-harness.js';

/** 10:00 in Asia/Ho_Chi_Minh; the local day ends at 17:00Z. */
const NOW = new Date('2026-11-11T03:00:00.000Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const later = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();
const OTHER_MEMBER = '0190f5c2-0000-7000-8000-0000000000b9';
const ownerView = { userId: OWNER, viewAll: true };
const salesView = { userId: SALES, viewAll: false };

let seq = 0;
const nextId = () => `0190f5c2-0000-7000-8000-${String(++seq).padStart(12, '0')}`;

function setup() {
  const h = brainHarness();
  /** A conversation with its facts and (optionally) a signal. */
  const add = (
    facts: Partial<TodayFacts> = {},
    signal: Partial<ConversationSignal> | null = null,
    ws = WS,
  ): string => {
    const id = facts.id ?? nextId();
    h.facts.set(id, {
      ws,
      id,
      provider: 'facebook',
      status: 'open',
      contactId: null,
      customerName: `Khách ${id.slice(-3)}`,
      customerAvatarUrl: null,
      assigneeId: null,
      awaitingSince: null,
      lastInboundAt: ago(60),
      followUpAt: null,
      followUpNote: '',
      lastHumanReplyAt: null,
      ...facts,
    });
    if (signal) {
      void h.store.saveSignal(ws, {
        ...blankSignal(id, null, NOW),
        evaluatedUntil: new Date(ago(60)),
        evaluatedAt: new Date(ago(30)),
        version: 1,
        ...signal,
      });
    }
    return id;
  };
  return { h, add };
}

const queue = (r: TodayResponse, key: string) => {
  const q = r.queues.find((x) => x.key === key);
  if (!q) throw new Error(`no queue ${key}`);
  return q;
};
const ids = (r: TodayResponse, key: string) =>
  (queue(r, key) as TodayConversationQueue).items.map((i) => i.conversationId);

function task(over: Partial<TaskDto>): TaskDto {
  return {
    id: nextId(),
    title: 'Gọi lại khách',
    note: null,
    dueAt: ago(60),
    assigneeUserId: null,
    assigneeName: null,
    status: 'open',
    contactId: null,
    conversationId: null,
    subjectType: null,
    subjectId: null,
    source: 'manual',
    createdAt: ago(600),
    doneAt: null,
    version: 1,
    ...over,
  };
}

describe('Today queue rules', () => {
  it('attention: a complaint or needs-a-person, until a person replies after the evaluation', async () => {
    const { h, add } = setup();
    const complaint = add({}, { mood: 'complaint', needsHumanReason: 'Giao sai màu' });
    const needs = add({}, { needsHuman: true, intent: 'Muốn đổi hàng' });
    const answered = add({ lastHumanReplyAt: ago(10) }, { mood: 'complaint' });
    const resolved = add({ status: 'resolved' }, { needsHuman: true });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'attention').sort()).toEqual([complaint, needs].sort());
    expect(ids(r, 'attention')).not.toContain(answered);
    expect(ids(r, 'attention')).not.toContain(resolved);
    const item = (queue(r, 'attention') as TodayConversationQueue).items.find(
      (i) => i.conversationId === complaint,
    );
    expect(item).toMatchObject({ reason: 'Giao sai màu', mood: 'complaint', channel: 'facebook' });
  });

  it('unanswered: waiting 15 minutes or more, no signal needed', async () => {
    const { h, add } = setup();
    const waiting = add({ awaitingSince: ago(20) });
    add({ awaitingSince: ago(10) });
    add({ awaitingSince: ago(60), status: 'resolved' });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'unanswered')).toEqual([waiting]);
    expect(queue(r, 'unanswered').count).toBe(1);
  });

  it('ready: stage ready', async () => {
    const { h, add } = setup();
    const ready = add({}, { stage: 'ready', intent: 'Chốt 2 áo size M' });
    add({}, { stage: 'exploring' });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'ready')).toEqual([ready]);
    expect((queue(r, 'ready') as TodayConversationQueue).items[0]?.reason).toBe('Chốt 2 áo size M');
  });

  it('ready ends once an order or a booking was made since the evaluation', async () => {
    const { h, add } = setup();
    // Evaluated 30 minutes ago (the setup's evaluatedAt).
    const ordered = add({}, { stage: 'ready' });
    const booked = add({}, { stage: 'ready' });
    const orderedBefore = add({}, { stage: 'ready' });
    const bookedAndDue = add({}, { stage: 'ready', followUpAt: new Date(ago(5)) });
    h.orders.set(ordered, new Date(ago(10)));
    h.bookings.set(booked, new Date(ago(10)));
    h.orders.set(orderedBefore, new Date(ago(45)));
    h.bookings.set(bookedAndDue, new Date(ago(1)));
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'ready')).toEqual([orderedBefore]);
    expect(queue(r, 'ready').count).toBe(1);
    // Not "ready" any more, it still falls to its next queue.
    expect(ids(r, 'follow_up')).toEqual([bookedAndDue]);
  });

  it('price_silent: stage price_asked and silent for 24 hours', async () => {
    const { h, add } = setup();
    const silent = add({ lastInboundAt: ago(25 * 60) }, { stage: 'price_asked' });
    add({ lastInboundAt: ago(120) }, { stage: 'price_asked' });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'price_silent')).toEqual([silent]);
  });

  it('ageing: price_silent between 24 hours and 14 days, ready judged within 7 days', async () => {
    const { h, add } = setup();
    const day = 24 * 60;
    const silent = add(
      { lastInboundAt: ago(13 * day) },
      { stage: 'price_asked', evaluatedUntil: new Date(ago(13 * day)) },
    );
    add(
      { lastInboundAt: ago(15 * day) },
      { stage: 'price_asked', evaluatedUntil: new Date(ago(15 * day)) },
    );
    const ready = add({}, { stage: 'ready', evaluatedAt: new Date(ago(6 * day)) });
    add({}, { stage: 'ready', evaluatedAt: new Date(ago(8 * day)) });
    // Never evaluated, set by hand 8 days ago.
    add({}, { stage: 'ready', evaluatedAt: null, updatedAt: new Date(ago(8 * day)) });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'price_silent')).toEqual([silent]);
    expect(ids(r, 'ready')).toEqual([ready]);
    // The briefing counts use the same rules.
    expect(await h.today.counts(WS, ownerView, NOW)).toMatchObject({ price_silent: 1, ready: 1 });
  });

  it('attention stays when the staff reply was before the evaluation that judged it', async () => {
    const { h, add } = setup();
    // The model covered messages up to 60 min ago, ran 30 min ago, and saw a reply at 40 min.
    const seen = add({ lastHumanReplyAt: ago(40) }, { mood: 'complaint' });
    const after = add({ lastHumanReplyAt: ago(20) }, { mood: 'complaint' });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'attention')).toEqual([seen]);
    expect(ids(r, 'attention')).not.toContain(after);
  });

  it('follow_up: the signal follow-up has come, or the reminder is due by the end of today', async () => {
    const { h, add } = setup();
    const bySignal = add({}, { followUpAt: new Date(ago(5)), followUpReason: 'Hẹn gọi lại' });
    const byReminder = add({ followUpAt: later(12 * 60), followUpNote: 'Hỏi lại size' });
    add({ followUpAt: later(15 * 60) }); // 01:00 tomorrow, local time
    add({}, { followUpAt: new Date(later(60)) });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'follow_up')).toEqual([bySignal, byReminder]);
    const reasons = (queue(r, 'follow_up') as TodayConversationQueue).items.map((i) => i.reason);
    expect(reasons).toEqual(['Hẹn gọi lại', 'Hỏi lại size']);
  });

  it('places a conversation in its first matching queue only, and leaves spam out', async () => {
    const { h, add } = setup();
    const both = add(
      { awaitingSince: ago(30), followUpAt: ago(5) },
      { mood: 'complaint', stage: 'ready' },
    );
    add({ status: 'spam', awaitingSince: ago(30) }, { stage: 'ready' });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'attention')).toEqual([both]);
    for (const key of ['unanswered', 'ready', 'price_silent', 'follow_up'])
      expect(queue(r, key).count).toBe(0);
  });

  it('caps items at 20 per queue while counting all', async () => {
    const { h, add } = setup();
    for (let i = 0; i < 23; i++) add({ awaitingSince: ago(20 + i) });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(queue(r, 'unanswered').count).toBe(23);
    expect(queue(r, 'unanswered').items).toHaveLength(20);
  });

  it('tasks: mine and unassigned, due by the end of today or overdue', async () => {
    const { h } = setup();
    const mine = task({ assigneeUserId: SALES, dueAt: ago(60) });
    const unassigned = task({ dueAt: later(6 * 60) });
    h.tasks.push(
      mine,
      unassigned,
      task({ assigneeUserId: OTHER_MEMBER }),
      task({ assigneeUserId: SALES, dueAt: later(24 * 60) }),
      task({ assigneeUserId: SALES, dueAt: null }),
    );
    const r = await h.today.today(WS, salesView, NOW);
    const tasks = queue(r, 'tasks');
    expect(tasks.count).toBe(2);
    expect(tasks.items.map((t) => (t as TaskDto).id)).toEqual([mine.id, unassigned.id]);
    // The owner gets the same "mine + unassigned" queue (controller ruling).
    expect(queue(await h.today.today(WS, ownerView, NOW), 'tasks').count).toBe(1);
  });

  it('returns the seven queues in order, the usage and the mode', async () => {
    const { h } = setup();
    await h.settings.put(WS, { ...DEFAULT_BRAIN_SETTINGS, mode: 'manual' });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(r.queues.map((q) => q.key)).toEqual([
      'attention',
      'unanswered',
      'ready',
      'price_silent',
      'follow_up',
      'approval',
      'tasks',
    ]);
    expect(r).toMatchObject({ usage: { used: 0, limit: 200 }, mode: 'manual' });
    // Without the care module the approval queue is empty.
    expect(queue(r, 'approval')).toEqual({ key: 'approval', count: 0, items: [] });
  });
});

describe('Today exclusions and visibility', () => {
  it('sales and care see their own and unassigned customers; the owner sees all', async () => {
    const { h, add } = setup();
    const own = add({ awaitingSince: ago(30), assigneeId: SALES });
    const free = add({ awaitingSince: ago(31) });
    const others = add({ awaitingSince: ago(32), assigneeId: OTHER_MEMBER });
    add({ awaitingSince: ago(40) }, null, OTHER_WS);
    const sales = await h.today.today(WS, salesView, NOW);
    expect(ids(sales, 'unanswered').sort()).toEqual([own, free].sort());
    const owner = await h.today.today(WS, ownerView, NOW);
    expect(ids(owner, 'unanswered').sort()).toEqual([own, free, others].sort());
    const item = (queue(owner, 'unanswered') as TodayConversationQueue).items.find(
      (i) => i.conversationId === own,
    );
    expect(item?.assigneeName).toBe('Bán hàng');
  });

  it('dismiss hides a conversation until a newer customer message arrives', async () => {
    const { h, add } = setup();
    const id = add({ awaitingSince: ago(30), lastInboundAt: ago(30) });
    await h.today.dismiss(WS, ownerView, id, NOW);
    expect(ids(await h.today.today(WS, ownerView, NOW), 'unanswered')).toEqual([]);
    expect((await h.store.getSignal(WS, id))?.dismissedUntilMessageAfter).toEqual(NOW);

    const fact = h.facts.get(id);
    if (fact) fact.lastInboundAt = later(1);
    const after = new Date(NOW.getTime() + 2 * 60_000);
    expect(ids(await h.today.today(WS, ownerView, after), 'unanswered')).toEqual([id]);
  });

  it('reads the viewer filter and the last staff reply into the candidate query', async () => {
    const { h, add } = setup();
    const complaint = add({}, { mood: 'complaint' });
    add({}, { stage: 'ready' });
    const seen: Parameters<typeof h.conversationFacade.todayCandidates>[1][] = [];
    const read = h.conversationFacade.todayCandidates.bind(h.conversationFacade);
    h.conversationFacade.todayCandidates = (ws, q) => {
      seen.push(q);
      return read(ws, q);
    };
    await h.today.today(WS, salesView, NOW);
    await h.today.today(WS, ownerView, NOW);
    expect(seen[0]).toMatchObject({ visibleTo: SALES, lastHumanFor: [complaint] });
    expect(seen[1]?.visibleTo).toBeUndefined();
  });

  it('counts: the queue sizes only, as the page counts them', async () => {
    const { h, add } = setup();
    add({ awaitingSince: ago(20) });
    add({}, { mood: 'complaint' });
    h.tasks.push(task({}));
    const counts = await h.today.counts(WS, ownerView, NOW);
    expect(counts).toEqual({
      attention: 1,
      unanswered: 1,
      ready: 0,
      price_silent: 0,
      follow_up: 0,
      approval: 0,
      tasks: 1,
    });
  });

  it('undo dismiss puts the conversation back; same visibility rule', async () => {
    const { h, add } = setup();
    const id = add({ awaitingSince: ago(30), lastInboundAt: ago(30) });
    await h.today.dismiss(WS, ownerView, id, NOW);
    expect(ids(await h.today.today(WS, ownerView, NOW), 'unanswered')).toEqual([]);
    await h.today.undismiss(WS, ownerView, id, NOW);
    expect(ids(await h.today.today(WS, ownerView, NOW), 'unanswered')).toEqual([id]);
    const others = add({ assigneeId: OTHER_MEMBER, awaitingSince: ago(30) });
    await expect(h.today.undismiss(WS, salesView, others, NOW)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('dismiss keeps the signal and refuses a conversation the viewer may not see', async () => {
    const { h, add } = setup();
    const ready = add({}, { stage: 'ready', note: 'Ghi chú' });
    await h.today.dismiss(WS, ownerView, ready, NOW);
    expect(await h.store.getSignal(WS, ready)).toMatchObject({ stage: 'ready', note: 'Ghi chú' });
    const others = add({ assigneeId: OTHER_MEMBER, awaitingSince: ago(30) });
    await expect(h.today.dismiss(WS, salesView, others, NOW)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      h.today.dismiss(WS, ownerView, '0190f5c2-0000-7000-8000-ffffffffffff', NOW),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('POST /today/refresh', () => {
  function withMessages(h: ReturnType<typeof setup>['h'], id: string, at: string) {
    const c = conversation({ lastInboundAt: at, awaitingSince: at });
    c.messages.push({ sender: 'customer', text: 'Còn hàng không?', at });
    h.conversations.set(id, c);
  }

  it('evaluates conversations with unevaluated customer messages, Today first', async () => {
    const { h, add } = setup();
    const waiting = add({ awaitingSince: ago(30), lastInboundAt: ago(30) });
    const evaluated = add(
      { lastInboundAt: ago(120) },
      { stage: 'ready', evaluatedUntil: new Date(ago(120)) },
    );
    const pendingOnly = add({ lastInboundAt: ago(5) });
    await h.store.scheduleJob(WS, pendingOnly, new Date(later(40)));
    for (const id of [waiting, evaluated, pendingOnly]) withMessages(h, id, ago(30));
    h.gateway.replies = [answer({ stage: 'ready' }), answer()];

    const r = await h.today.refresh(WS, ownerView, NOW);
    expect(r).toMatchObject({ evaluated: 2, capped: false });
    expect(h.gateway.calls).toHaveLength(2);
    expect(await h.store.getSignal(WS, waiting)).not.toBeNull();
    expect(await h.store.getSignal(WS, pendingOnly)).not.toBeNull();
    expect((await h.usage.usage(WS, NOW)).used).toBe(2);
  });

  it('does not pay again for a conversation evaluated minutes ago', async () => {
    const { h, add } = setup();
    // Evaluated 2 minutes ago, covering its last customer message.
    const fresh = add(
      { awaitingSince: ago(30), lastInboundAt: ago(5) },
      { evaluatedUntil: new Date(ago(5)), evaluatedAt: new Date(ago(2)) },
    );
    withMessages(h, fresh, ago(5));
    const r = await h.today.refresh(WS, ownerView, NOW);
    expect(r).toMatchObject({ evaluated: 0 });
    expect(h.gateway.calls).toHaveLength(0);
  });

  it('starts no evaluation after the time budget and says how many are left', async () => {
    const { h, add } = setup();
    const a = add({ awaitingSince: ago(30), lastInboundAt: ago(30) });
    const b = add({ awaitingSince: ago(40), lastInboundAt: ago(40) });
    withMessages(h, a, ago(30));
    withMessages(h, b, ago(40));
    const r = await h.today.refresh(WS, ownerView, NOW, 0);
    expect(r).toMatchObject({ evaluated: 0, capped: false, partial: true, remaining: 2 });
    expect(h.gateway.calls).toHaveLength(0);
    const full = await h.today.refresh(WS, ownerView, NOW);
    expect(full).toMatchObject({ evaluated: 2, partial: false, remaining: 0 });
  });

  it('stops at the cap and says so', async () => {
    const { h, add } = setup();
    h.setLimit(1);
    const a = add({ awaitingSince: ago(30), lastInboundAt: ago(30) });
    const b = add({ awaitingSince: ago(40), lastInboundAt: ago(40) });
    withMessages(h, a, ago(30));
    withMessages(h, b, ago(40));
    const r = await h.today.refresh(WS, ownerView, NOW);
    expect(r).toMatchObject({ evaluated: 1, capped: true });
    expect(h.gateway.calls).toHaveLength(1);
  });
});

describe('POST /conversations/{id}/reply-draft', () => {
  it('makes one basic-tier call from the note, the last 20 messages and the persona', async () => {
    const { h, add } = setup();
    const id = add({ awaitingSince: ago(30) }, { note: 'Khách hỏi áo khoác size M.' });
    const fact = h.facts.get(id);
    if (fact) fact.botId = '0190f5c2-0000-7000-8000-0000000000e1';
    const c = conversation();
    for (let i = 0; i < 25; i++)
      c.messages.push({ sender: 'customer', text: `tin ${i}`, at: ago(60 - i) });
    h.conversations.set(id, c);
    h.gateway.replies = ['"Dạ chị ơi, áo size M còn ạ."'];

    const r = await h.drafts.draft(WS, ownerView, id, NOW);
    expect(r.text).toBe('Dạ chị ơi, áo size M còn ạ.');
    expect(h.gateway.calls).toHaveLength(1);
    const call = h.gateway.calls[0];
    expect(call?.tier).toBe('basic');
    const input = String(call?.messages[1]?.content);
    expect(input).toContain('Khách hỏi áo khoác size M.');
    expect(input).toContain('customer=chị');
    expect(input).toContain('tin 24');
    expect(input).not.toContain('tin 4\n');
    expect((await h.usage.usage(WS, NOW)).used).toBe(1);
    // Metered apart from evaluations.
    expect(h.store.runs.map((x) => x.trigger)).toEqual(['draft']);
  });

  it('refuses when the day is used up, and gives the evaluation back on failure', async () => {
    const { h, add } = setup();
    const id = add({});
    const c = conversation();
    c.messages.push({ sender: 'customer', text: 'Alo', at: ago(5) });
    h.conversations.set(id, c);
    h.gateway.replies = [new Error('boom')];
    await expect(h.drafts.draft(WS, ownerView, id, NOW)).rejects.toMatchObject({
      code: 'AI_UNAVAILABLE',
    });
    expect((await h.usage.usage(WS, NOW)).used).toBe(0);
    h.setLimit(0);
    await expect(h.drafts.draft(WS, ownerView, id, NOW)).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    });
    expect(h.gateway.calls).toHaveLength(1);
  });

  it('refuses a conversation the viewer may not see', async () => {
    const { h, add } = setup();
    const id = add({ assigneeId: OTHER_MEMBER });
    await expect(h.drafts.draft(WS, salesView, id, NOW)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(h.gateway.calls).toHaveLength(0);
  });
});

describe('Today with the care agent (ADR-031)', () => {
  const draft = (conversationId: string) => ({
    conversationId,
    contactId: null,
    customerName: 'Khách',
    avatarUrl: null,
    channel: 'facebook',
    reason: '',
    stage: 'price_asked' as const,
    mood: 'neutral' as const,
    at: ago(10),
    assigneeId: null,
    assigneeName: null,
    stageLocked: false,
    careMessageId: nextId(),
    template: 'silent' as const,
    text: 'Dạ mẫu này vẫn còn ạ',
    windowClosesAt: later(600),
    createdAt: ago(10),
  });

  it('lists the care drafts in "approval" and counts them, as the viewer sees them', async () => {
    const { h, add } = setup();
    const conv = add({});
    const seen: { viewAll: boolean; limit: number }[] = [];
    h.extensions.registerCare({
      approvals: async (_ws, viewer, _now, limit) => {
        seen.push({ viewAll: viewer.viewAll, limit });
        return { count: 3, items: limit ? [draft(conv)] : [] };
      },
      afterSaleDue: async () => [],
      impact: async () => {
        throw new Error('not used');
      },
    });
    const r = await h.today.today(WS, salesView, NOW);
    expect(queue(r, 'approval')).toMatchObject({ count: 3, items: [{ conversationId: conv }] });
    expect((await h.today.counts(WS, salesView, NOW)).approval).toBe(3);
    expect(seen).toEqual([
      { viewAll: false, limit: 20 },
      { viewAll: false, limit: 0 },
    ]);
  });

  it('puts a due after-sales check-in in "follow_up", after the other rules', async () => {
    const { h, add } = setup();
    const due = add({});
    const waiting = add({ awaitingSince: ago(30) });
    h.extensions.registerCare({
      approvals: async () => ({ count: 0, items: [] }),
      afterSaleDue: async () => [due, waiting],
      impact: async () => {
        throw new Error('not used');
      },
    });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(ids(r, 'follow_up')).toEqual([due]);
    expect((queue(r, 'follow_up') as TodayConversationQueue).items[0]?.careTemplate).toBe(
      'after_sale',
    );
    expect(ids(r, 'unanswered')).toEqual([waiting]);
  });

  it('keeps Today working when the care source fails', async () => {
    const { h, add } = setup();
    add({ awaitingSince: ago(30) });
    h.extensions.registerCare({
      approvals: async () => {
        throw new Error('down');
      },
      afterSaleDue: async () => {
        throw new Error('down');
      },
      impact: async () => {
        throw new Error('down');
      },
    });
    const r = await h.today.today(WS, ownerView, NOW);
    expect(queue(r, 'approval').count).toBe(0);
    expect(queue(r, 'unanswered').count).toBe(1);
  });
});
