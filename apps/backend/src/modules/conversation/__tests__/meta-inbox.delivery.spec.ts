import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiFacade } from '../../ai/api/index.js';
import type { BillingFacade } from '../../billing/api/index.js';
import type { BotView } from '../../bot/api/index.js';
import { MetaInboxProcessor } from '../application/jobs/meta-inbox.processor.js';
import { SEND_GAP_MS } from '../application/jobs/reply-delivery.js';
import { fakeBilling } from './fakes.js';
import { answer, job, pics, setup } from './factories/meta-inbox-harness.js';

// Spec §7: `send_message` output is delivered as it is sent (through the turn's sink) and paced.

afterEach(() => vi.useRealTimers());

describe('MetaInboxProcessor — messages sent during the turn', () => {
  it('delivers each send_message as it happens, with its own keys, before the final answer', async () => {
    const { ai, keys, texts, run } = setup();
    const results: { delivered: number }[] = [];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      results.push(await options.sink!.send({ text: 'Dạ có ạ. Còn size 40!', images: [] }));
      results.push(await options.sink!.send({ images: pics }));
      results.push(await options.sink!.send({ text: 'Mẫu này đẹp lắm ạ', images: pics }));
      return answer('Anh cần gì thêm không?');
    });
    await run(job('e1', 'giày oxford còn không?'));
    expect(keys()).toEqual([
      'bot:e1:s1',
      'bot:e1:s1:t2',
      'bot:e1:s2:img',
      'bot:e1:s3',
      'bot:e1:s3:img',
      'bot:e1',
    ]);
    expect(texts()).toEqual([
      'Dạ có ạ.',
      'Còn size 40!',
      '',
      'Mẫu này đẹp lắm ạ',
      '',
      'Anh cần gì thêm không?',
    ]);
    expect(results).toEqual([{ delivered: 2 }, { delivered: 1 }, { delivered: 2 }]);
  });

  it('keeps the album fallback for pictures sent during the turn', async () => {
    const { ai, channels, keys, run } = setup();
    vi.mocked(channels.deliver).mockResolvedValueOnce({
      externalId: null,
      status: 'failed',
      failureCode: 'provider_rejected',
    });
    let delivered = 0;
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      delivered = (await options.sink!.send({ images: pics })).delivered;
      return answer('');
    });
    await run(job('e2', 'cho xem ảnh'));
    expect(keys()).toEqual(['bot:e2:s1:img', 'bot:e2:s1:img:0', 'bot:e2:s1:img:1']);
    expect(delivered).toBe(2);
  });

  it('bills the turn when the album failed but its single pictures went out', async () => {
    const { ai, billing, channels, run } = setup();
    vi.mocked(channels.deliver).mockResolvedValueOnce({
      externalId: null,
      status: 'failed',
      failureCode: 'provider_rejected',
    });
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ images: pics });
      return answer('');
    });
    await run(job('e2b', 'cho xem ảnh'));
    // The first committed message (the album) failed; the first sent one is a single picture.
    expect(billing.captureReply).toHaveBeenCalledWith(expect.anything(), 'bot:e2b');
    expect(billing.releaseReply).not.toHaveBeenCalled();
  });

  it('waits 800 ms between consecutive sends, the final answer included (fake timers)', async () => {
    vi.useFakeTimers();
    const { ai, channels, processor } = setup({
      now: () => Date.now(),
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    });
    const at: number[] = [];
    vi.mocked(channels.deliver).mockImplementation(async () => {
      at.push(Date.now());
      return { externalId: `x${at.length}`, status: 'sent', failureCode: null };
    });
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Một. Hai.', images: [] });
      await options.sink!.send({ text: 'Ba', images: [] });
      return answer('Bốn');
    });
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([job('e3', 'hi')]);
    const tick = processor.tick();
    await vi.advanceTimersByTimeAsync(5_000);
    await tick;
    expect(at).toHaveLength(4);
    // Bubbles of one message go out together; each new send waits for the gap.
    expect(at[1]! - at[0]!).toBeLessThan(SEND_GAP_MS);
    expect(at[2]! - at[1]!).toBeGreaterThanOrEqual(SEND_GAP_MS);
    expect(at[3]! - at[2]!).toBeGreaterThanOrEqual(SEND_GAP_MS);
  });

  it('paces through the injected clock and never waits before the first send', async () => {
    const { ai, sleeps, run } = setup();
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'A', images: [] });
      await options.sink!.send({ text: 'B', images: [] });
      return answer('C');
    });
    await run(job('e4', 'hi'));
    expect(sleeps).toEqual([SEND_GAP_MS, SEND_GAP_MS]);
  });

  it('stops sending after a takeover: later sends deliver nothing, no final, no hand-off', async () => {
    const { ai, channels, inbox, keys, takeOver, run } = setup();
    vi.mocked(channels.deliver).mockImplementationOnce(async () => {
      await takeOver();
      return { externalId: 'ok', status: 'sent', failureCode: null };
    });
    const results: { delivered: number }[] = [];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      results.push(await options.sink!.send({ text: 'A', images: [] }));
      results.push(await options.sink!.send({ text: 'B', images: pics }));
      return answer('C', { outcome: 'handoff' });
    });
    const handOff = vi.spyOn(inbox, 'handOff');
    await run(job('e5', 'hi'));
    expect(keys()).toEqual(['bot:e5:s1']);
    expect(results).toEqual([{ delivered: 1 }, { delivered: 0 }]);
    expect(handOff).not.toHaveBeenCalled();
  });

  it('stops sending when the customer writes again', async () => {
    const { ai, channels, keys, run } = setup();
    const results: { delivered: number }[] = [];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      results.push(await options.sink!.send({ text: 'A', images: [] }));
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      results.push(await options.sink!.send({ text: 'B', images: [] }));
      return answer('C');
    });
    await run(job('e6', 'hi'));
    expect(keys()).toEqual(['bot:e6:s1']);
    expect(results).toEqual([{ delivered: 1 }, { delivered: 0 }]);
  });

  it('sends no fallback when the agent already spoke and the final text is empty', async () => {
    const { ai, keys, run } = setup();
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Đây ạ', images: pics });
      return answer('');
    });
    await run(job('e7', 'ảnh?'));
    expect(keys()).toEqual(['bot:e7:s1', 'bot:e7:s1:img']);
  });

  it('sends the fallback message when nothing was sent at all', async () => {
    const { ai, keys, texts, run } = setup();
    ai.reply.mockResolvedValueOnce(answer(''));
    await run(job('e8', 'hi'));
    expect(keys()).toEqual(['bot:e8']);
    expect(texts()).toEqual(['Shop will get back to you']);
  });

  it('bills the turn once on its first delivered message, also when that is a send_message', async () => {
    const billing = fakeBilling();
    const { ai, inbox, channels } = setup();
    const processor = new MetaInboxProcessor(
      channels,
      inbox,
      ai as unknown as AiFacade,
      { getBot: async () => ({ isActive: true, handoffMessage: 'x' }) as BotView },
      billing as unknown as BillingFacade,
      { fetch: async () => null },
      false,
      undefined,
      { now: () => 0, sleep: async () => undefined },
    );
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'A', images: [] });
      return answer('B');
    });
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([job('e9', 'hi')]);
    await processor.tick();
    expect(billing.captureReply).toHaveBeenCalledTimes(1);
    expect(billing.releaseReply).not.toHaveBeenCalled();
  });
});

describe('MetaInboxProcessor — send details (fix round 1)', () => {
  it('paces the final 800 ms after a sink send and checks for newer messages before it', async () => {
    const order: string[] = [];
    let clock = 0;
    const { ai, channels, run } = setup({
      now: () => clock,
      sleep: async (ms) => {
        order.push(`sleep ${ms}`);
        clock += ms;
      },
    });
    vi.mocked(channels.hasNewerCustomerEvent).mockImplementation(async () => {
      order.push('newer?');
      return false;
    });
    vi.mocked(channels.deliver).mockImplementation(async (_w, _c, _r, message) => {
      order.push(`send ${message.text}`);
      return { externalId: message.text, status: 'sent', failureCode: null };
    });
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'A', images: [] });
      return answer('B');
    });
    await run(job('p1', 'hi'));
    expect(order.slice(order.indexOf('send A'))).toEqual([
      'send A',
      'newer?', // after the run: the final is not stale
      `sleep ${SEND_GAP_MS}`,
      'send B',
    ]);
  });

  it('checks for a newer message after the pacing wait and between a text and its album', async () => {
    const { ai, channels, keys, run } = setup();
    vi.mocked(channels.deliver).mockImplementationOnce(async () => {
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      return { externalId: 'ok', status: 'sent', failureCode: null };
    });
    let delivered = -1;
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      delivered = (await options.sink!.send({ text: 'A', images: pics })).delivered;
      return answer('');
    });
    await run(job('p2', 'hi'));
    expect(keys()).toEqual(['bot:p2:s1']);
    expect(delivered).toBe(1);
  });

  it('counts the bubbles already sent when a send throws midway', async () => {
    const { ai, inbox, keys, run } = setup();
    vi.spyOn(inbox, 'commitBotFollowUp').mockRejectedValueOnce(new Error('db down'));
    let delivered = -1;
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      delivered = (await options.sink!.send({ text: 'Một ý. Hai ý.', images: [] })).delivered;
      return answer('Ba');
    });
    await run(job('p3', 'hi'));
    expect(delivered).toBe(1);
    // The turn stops after the failure: no final answer.
    expect(keys()).toEqual(['bot:p3:s1']);
  });
});
