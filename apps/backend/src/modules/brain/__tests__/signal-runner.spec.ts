import { describe, expect, it } from 'vitest';

import { JOBS_PER_TICK, TICK_BUDGET_MS } from '../application/signal-runner.js';
import { DEFAULT_BRAIN_SETTINGS } from '../domain/schedule.js';
import { brainHarness, CONV, conversation, WS } from './factories/brain-harness.js';

const T0 = new Date('2026-11-11T03:00:00.000Z');
const plus = (min: number) => new Date(T0.getTime() + min * 60_000);
const event = (type: string, at: Date) => ({
  workspaceId: WS,
  conversationId: CONV,
  payload: { messageId: `m-${at.getTime()}`, type, occurredAt: at.toISOString() },
  createdAt: at,
});

function setup(opts: Parameters<typeof brainHarness>[0] = {}) {
  const h = brainHarness(opts);
  const c = conversation();
  c.messages.push({ sender: 'customer', text: 'Giá bao nhiêu?', at: T0.toISOString() });
  h.conversations.set(CONV, c);
  return { h, c };
}

describe('rule 1: the outbox consumer schedules idle jobs', () => {
  it('schedules a customer message idle minutes later and pushes it back on the next one', async () => {
    const { h } = setup();
    h.events.push(event('message', T0));
    await h.scheduler.pass(T0);
    expect(h.store.jobs.get(`${WS}/${CONV}`)?.runAfter).toEqual(plus(45));
    h.events.push(event('message', plus(10)));
    await h.scheduler.pass(plus(10));
    expect(h.store.jobs.get(`${WS}/${CONV}`)?.runAfter).toEqual(plus(55));
  });

  it('does not schedule staff echoes, and uses the business idle minutes', async () => {
    const { h } = setup();
    h.events.push(event('echo', T0));
    expect(await h.scheduler.pass(T0)).toBe(0);
    expect(h.store.jobs.size).toBe(0);
    await h.settings.put(WS, { ...DEFAULT_BRAIN_SETTINGS, idleMinutes: 30 });
    h.events.push(event('message', T0));
    await h.scheduler.pass(T0);
    expect(h.store.jobs.get(`${WS}/${CONV}`)?.runAfter).toEqual(plus(30));
  });

  it('schedules nothing in manual mode or for day-old messages', async () => {
    const { h } = setup();
    h.events.push(event('message', new Date(T0.getTime() - 25 * 3_600_000)));
    expect(await h.scheduler.pass(T0)).toBe(0);
    await h.settings.put(WS, { ...DEFAULT_BRAIN_SETTINGS, mode: 'manual' });
    h.events.push(event('message', T0));
    expect(await h.scheduler.pass(T0)).toBe(0);
    expect(h.store.jobs.size).toBe(0);
  });
});

describe('rule 2: the tick runs due jobs', () => {
  it('waits for the idle time, evaluates once and drops the job', async () => {
    const { h } = setup();
    h.events.push(event('message', T0));
    expect(await h.runner.tick(plus(1))).toBe(0);
    expect(await h.runner.tick(plus(46))).toBe(1);
    expect(h.gateway.calls).toHaveLength(1);
    expect(h.store.jobs.size).toBe(0);
    expect(h.store.runs[0]?.trigger).toBe('idle');
  });

  it('claims batch after batch within the time budget', async () => {
    const { h } = setup();
    const ids = Array.from(
      { length: 12 },
      (_, i) => `0190f5c2-0000-7000-8000-0000000d${String(i).padStart(4, '0')}`,
    );
    for (const id of ids) {
      const c = conversation();
      c.messages.push({ sender: 'customer', text: 'Giá?', at: T0.toISOString() });
      h.conversations.set(id, c);
      await h.store.scheduleJob(WS, id, T0);
    }
    expect(await h.runner.tick(plus(1))).toBe(12);
    expect(h.gateway.calls).toHaveLength(12);

    // Past the budget no new batch starts (the first always runs).
    for (const id of ids) await h.store.scheduleJob(WS, id, plus(100));
    for (const id of ids) {
      h.conversations.get(id)?.messages.push({
        sender: 'customer',
        text: 'Còn không?',
        at: plus(60).toISOString(),
      });
    }
    let t = 0;
    h.runner.clock = () => (t += TICK_BUDGET_MS);
    expect(await h.runner.tick(plus(101))).toBe(JOBS_PER_TICK);
  });

  it('leases a claimed job for two minutes', async () => {
    const { h } = setup();
    await h.store.scheduleJob(WS, CONV, T0);
    const [job] = await h.store.claimDueJobs(T0, 5, 120_000);
    expect(job?.attempts).toBe(1);
    expect(await h.store.claimDueJobs(plus(1), 5, 120_000)).toHaveLength(0);
    expect(await h.store.claimDueJobs(plus(3), 5, 120_000)).toHaveLength(1);
  });

  it('drops the job without a call in manual mode, for closed conversations and when nothing is new', async () => {
    for (const prepare of [
      (h: ReturnType<typeof setup>) =>
        h.h.settings.put(WS, { ...DEFAULT_BRAIN_SETTINGS, mode: 'manual' }),
      (h: ReturnType<typeof setup>) => {
        h.c.facts = { ...h.c.facts, status: 'resolved' };
        return Promise.resolve();
      },
      (h: ReturnType<typeof setup>) => {
        h.c.facts = { ...h.c.facts, isTest: true };
        return Promise.resolve();
      },
      (h: ReturnType<typeof setup>) => {
        h.c.messages.splice(0, 1, { sender: 'bot', text: 'Chào chị', at: T0.toISOString() });
        return Promise.resolve();
      },
    ]) {
      const s = setup();
      await prepare(s);
      await s.h.store.scheduleJob(WS, CONV, T0);
      await s.h.runner.tick(plus(1));
      expect(s.h.gateway.calls).toHaveLength(0);
      expect(s.h.store.jobs.size).toBe(0);
    }
  });

  it('keeps a job that a newer message pushed back while it ran', async () => {
    const { h } = setup();
    await h.store.scheduleJob(WS, CONV, T0);
    const [job] = await h.store.claimDueJobs(plus(1), 5, 120_000);
    await h.store.scheduleJob(WS, CONV, plus(50));
    await h.store.finishJob(WS, CONV, job?.runAfter ?? T0);
    expect(h.store.jobs.get(`${WS}/${CONV}`)).toMatchObject({
      runAfter: plus(50),
      leaseUntil: null,
    });
  });
});

describe('rule 3: the cap', () => {
  it('caps the job when the day is used up and runs it after local midnight', async () => {
    const { h } = setup({ limit: 0 });
    await h.store.scheduleJob(WS, CONV, T0);
    await h.runner.tick(plus(1));
    const job = h.store.jobs.get(`${WS}/${CONV}`);
    expect(job).toMatchObject({ status: 'capped', runAfter: new Date('2026-11-11T17:00:00.000Z') });
    expect(h.gateway.calls).toHaveLength(0);

    // Still the same day: stays capped.
    await h.runner.tick(new Date('2026-11-11T16:00:00.000Z'));
    expect(h.store.jobs.get(`${WS}/${CONV}`)?.status).toBe('capped');

    // The next day's first tick puts it back in line, a few minutes behind the day's fresh jobs.
    h.setLimit(200);
    await h.runner.tick(new Date('2026-11-11T17:00:15.000Z'));
    expect(h.store.jobs.get(`${WS}/${CONV}`)).toMatchObject({
      status: 'pending',
      runAfter: new Date('2026-11-11T17:05:15.000Z'),
    });
    expect(h.gateway.calls).toHaveLength(0);
    await h.runner.tick(new Date('2026-11-11T17:05:15.000Z'));
    expect(h.gateway.calls).toHaveLength(1);
    expect(h.store.jobs.size).toBe(0);
    expect(await h.store.usedOn(WS, '2026-11-12')).toBe(1);
  });

  it('retries a failed call later and gives the evaluation back', async () => {
    const { h } = setup();
    h.gateway.replies.push(new Error('provider down'));
    await h.store.scheduleJob(WS, CONV, T0);
    await h.runner.tick(plus(1));
    expect(h.store.jobs.get(`${WS}/${CONV}`)?.runAfter).toEqual(plus(11));
    expect(await h.store.usedOn(WS, '2026-11-11')).toBe(0);
  });
});
