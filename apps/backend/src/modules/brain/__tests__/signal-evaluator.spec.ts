import { describe, expect, it } from 'vitest';

import {
  ACCOUNT,
  answer,
  brainHarness,
  CONV,
  conversation,
  OWNER,
  SALES,
  WS,
} from './factories/brain-harness.js';

const NOW = new Date('2026-11-11T03:00:00.000Z');
const LATER = new Date('2026-11-11T04:00:00.000Z');
const msg = (sender: 'customer' | 'human' | 'bot', text: string, at: string) => ({
  sender,
  text,
  at,
});

function setup(opts: Parameters<typeof brainHarness>[0] = {}) {
  const h = brainHarness(opts);
  const c = conversation({ contactId: null });
  c.messages.push(
    msg('customer', 'Áo khoác này giá bao nhiêu?', '2026-11-11T01:00:00.000Z'),
    msg('bot', 'Dạ 450k ạ', '2026-11-11T01:00:05.000Z'),
  );
  h.conversations.set(CONV, c);
  return { h, c };
}

const userInput = (h: ReturnType<typeof brainHarness>, call = 0) =>
  h.gateway.calls[call]?.messages.find((m) => m.role === 'user')?.content ?? '';

describe('SignalEvaluator', () => {
  it('evaluates on tier basic with a JSON schema and writes the signals', async () => {
    const { h } = setup();
    const r = await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(r.status).toBe('ok');
    const call = h.gateway.calls[0];
    expect(call).toMatchObject({ tier: 'basic', maxOutputTokens: 600, timeoutMs: 20_000 });
    expect(call?.responseFormat).toBeDefined();
    const s = await h.store.getSignal(WS, CONV);
    expect(s).toMatchObject({
      stage: 'price_asked',
      note: 'Khách hỏi giá áo khoác size M.',
      evaluatedUntil: new Date('2026-11-11T01:00:05.000Z'),
      version: 1,
    });
  });

  it('starts from the stored summary on the first run, then from its own note', async () => {
    const { h, c } = setup();
    h.summaries.set(CONV, 'Tóm tắt cũ của hội thoại');
    await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(userInput(h)).toContain('EARLIER SUMMARY:\nTóm tắt cũ của hội thoại');
    expect(userInput(h)).toContain('Customer: Áo khoác này giá bao nhiêu?');

    // Incremental: the next run sends only the messages after evaluated_until, with the note.
    c.messages.push(msg('customer', 'Còn size L không?', '2026-11-11T03:30:00.000Z'));
    h.gateway.replies.push(answer({ stage: 'ready', note: 'Ghi chú mới' }));
    await h.evaluator.evaluate(WS, CONV, 'manual', LATER);
    const second = userInput(h, 1);
    expect(second).toContain('PREVIOUS NOTE:\nKhách hỏi giá áo khoác size M.');
    expect(second).not.toContain('EARLIER SUMMARY');
    expect(second).toContain('Còn size L không?');
    expect(second).not.toContain('Áo khoác này giá bao nhiêu?');
    expect((await h.store.getSignal(WS, CONV))?.stage).toBe('ready');
  });

  it('answers nothing_new without a call or a reservation when no customer wrote since', async () => {
    const { h, c } = setup();
    await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    c.messages.push(msg('human', 'Shop gửi ảnh ạ', '2026-11-11T02:00:00.000Z'));
    const r = await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(r.status).toBe('nothing_new');
    expect(h.gateway.calls).toHaveLength(1);
    expect(await h.store.usedOn(WS, '2026-11-11')).toBe(1);
  });

  it('retries an invalid answer once and records one run per call', async () => {
    const { h } = setup();
    h.gateway.replies.push('not json', answer({ mood: 'positive' }));
    const r = await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(r.status).toBe('ok');
    expect(h.gateway.calls).toHaveLength(2);
    expect(h.store.runs.map((x) => x.outcome)).toEqual(['invalid', 'ok']);
    expect(h.store.runs[1]).toMatchObject({
      trigger: 'manual',
      tier: 'basic',
      model: 'fake-basic',
      inputTokens: 1200,
      outputTokens: 180,
    });
  });

  it('leaves the signals unchanged after two invalid answers', async () => {
    const { h } = setup();
    h.gateway.replies.push(answer({ stage: 'nope' }), '{"stage":');
    const r = await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(r).toEqual({ status: 'failed', reason: 'invalid' });
    expect(await h.store.getSignal(WS, CONV)).toBeNull();
    expect(h.store.runs.map((x) => x.outcome)).toEqual(['invalid', 'invalid']);
  });

  it('releases the reservation when the call fails', async () => {
    const { h } = setup();
    h.gateway.replies.push(Object.assign(new Error('boom'), { name: 'AiProviderFailedError' }));
    const r = await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(r).toEqual({ status: 'failed', reason: 'error' });
    expect(await h.store.usedOn(WS, '2026-11-11')).toBe(0);
    expect(h.store.runs.map((x) => x.outcome)).toEqual(['error']);
  });

  it('records a timeout as such', async () => {
    const { h } = setup();
    h.gateway.replies.push(Object.assign(new Error('slow'), { name: 'TimeoutError' }));
    expect(await h.evaluator.evaluate(WS, CONV, 'manual', NOW)).toEqual({
      status: 'failed',
      reason: 'timeout',
    });
    expect(h.store.runs[0]?.outcome).toBe('timeout');
  });

  it('answers capped without calling the model when the day is used up', async () => {
    const { h } = setup({ limit: 1 });
    await h.store.reserveUsage(WS, '2026-11-11', 1);
    const r = await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(r.status).toBe('capped');
    expect(h.gateway.calls).toHaveLength(0);
  });

  it('gives every plan 200 evaluations when it does not define the key, and null is unlimited', async () => {
    const { h } = setup({ limit: 'missing' });
    expect(await h.usage.limit(WS)).toBe(200);
    h.setLimit(null);
    expect(await h.usage.limit(WS)).toBeNull();
    expect((await h.facade.usage(WS)).limit).toBeNull();
  });

  it('never evaluates spam or test conversations', async () => {
    const { h, c } = setup();
    c.facts = { ...c.facts, status: 'spam' };
    expect((await h.evaluator.evaluate(WS, CONV, 'manual', NOW)).status).toBe('disabled');
    c.facts = { ...c.facts, status: 'open', isTest: true };
    expect((await h.evaluator.evaluate(WS, CONV, 'manual', NOW)).status).toBe('disabled');
    expect(h.gateway.calls).toHaveLength(0);
  });

  it('alerts the owner and the assignee once when the mood turns to complaint', async () => {
    const { h, c } = setup();
    c.facts = { ...c.facts, assigneeId: SALES };
    h.gateway.replies.push(
      answer({ mood: 'complaint', needsHuman: true, needsHumanReason: 'Giao hàng trễ 5 ngày' }),
    );
    await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(h.notified.map((n) => n.userId).sort()).toEqual([OWNER, SALES].sort());
    expect(h.notified[0]).toMatchObject({
      accountId: ACCOUNT,
      type: 'brain.complaint',
      target: { kind: 'conversation', conversationId: CONV },
      dedupKey: `brain.complaint:${CONV}:2026-11-11`,
      title: 'Chị Lan đang phàn nàn',
    });
    expect(h.notified[0]?.body).toContain('Giao hàng trễ 5 ngày');

    // Still a complaint on the next run: no new alert.
    c.messages.push(msg('customer', 'Vẫn chưa thấy hàng', '2026-11-11T02:30:00.000Z'));
    h.gateway.replies.push(answer({ mood: 'complaint' }));
    await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(h.notified).toHaveLength(2);
  });

  it("keeps a member's stage lock and dismissal made while the model was answering", async () => {
    const { h } = setup();
    const generate = h.gateway.generate.bind(h.gateway);
    h.gateway.generate = async (request) => {
      await h.facade.updateSignal(WS, CONV, { stage: 'won' }, NOW);
      await h.today.dismiss(WS, { userId: OWNER, viewAll: true }, CONV, NOW);
      return generate(request);
    };
    h.facts.set(CONV, {
      ws: WS,
      id: CONV,
      provider: 'facebook',
      status: 'open',
      contactId: null,
      customerName: 'Chị Lan',
      customerAvatarUrl: null,
      assigneeId: null,
      awaitingSince: null,
      lastInboundAt: '2026-11-11T01:00:00.000Z',
      followUpAt: null,
      followUpNote: '',
      lastHumanReplyAt: null,
    });
    h.gateway.replies.push(answer({ stage: 'exploring', note: 'Ghi chú của AI' }));
    const r = await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect(r.status).toBe('ok');
    expect(await h.store.getSignal(WS, CONV)).toMatchObject({
      stage: 'won',
      stageLocked: true,
      note: 'Ghi chú của AI',
      dismissedUntilMessageAfter: NOW,
      version: 3,
    });
  });

  it('never pays twice for covered messages (manual, later refresh, idle job of the burst)', async () => {
    const { h, c } = setup();
    c.messages.push(msg('customer', 'Ship tới quận 7 được không?', '2026-11-11T02:55:00.000Z'));
    await h.evaluator.evaluate(WS, CONV, 'manual', NOW);
    expect((await h.store.getSignal(WS, CONV))?.evaluatedUntil).toEqual(
      new Date('2026-11-11T02:55:00.000Z'),
    );
    expect((await h.evaluator.evaluate(WS, CONV, 'manual', NOW)).status).toBe('nothing_new');
    expect((await h.evaluator.evaluate(WS, CONV, 'refresh', LATER)).status).toBe('nothing_new');
    expect((await h.evaluator.evaluate(WS, CONV, 'idle', LATER)).status).toBe('skipped');
    expect(h.gateway.calls).toHaveLength(1);
    // The next customer message is evaluated, and only it is sent.
    c.messages.push(msg('customer', 'Shop ơi?', '2026-11-11T03:20:00.000Z'));
    expect((await h.evaluator.evaluate(WS, CONV, 'idle', LATER)).status).toBe('ok');
    expect(userInput(h, 1)).toContain('Shop ơi?');
    expect(userInput(h, 1)).not.toContain('Ship tới quận 7');
  });

  it('answers capped for an idle job before reading the conversation', async () => {
    const { h } = setup({ limit: 1 });
    await h.store.reserveUsage(WS, '2026-11-11', 1);
    let reads = 0;
    const read = h.conversationFacade.signalContext.bind(h.conversationFacade);
    h.conversationFacade.signalContext = (...args) => {
      reads++;
      return read(...args);
    };
    expect((await h.evaluator.evaluate(WS, CONV, 'idle', NOW)).status).toBe('capped');
    expect(reads).toBe(0);
  });

  it('drops an idle job whose customer last wrote more than a day ago', async () => {
    const { h } = setup();
    const r = await h.evaluator.evaluate(WS, CONV, 'idle', new Date('2026-11-12T02:00:00.000Z'));
    expect(r).toEqual({ status: 'skipped', reason: 'stale' });
    expect(h.gateway.calls).toHaveLength(0);
  });

  it('throws NOT_FOUND for a conversation of another workspace', async () => {
    const { h } = setup();
    const other = '0190f5c2-0000-7000-8000-0000000000a2';
    await expect(
      h.evaluator.evaluate(other as typeof WS, CONV, 'manual', NOW),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
