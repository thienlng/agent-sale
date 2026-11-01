import { describe, expect, it, vi } from 'vitest';
import type { ReplyResult } from '../../ai/api/index.js';
import { answer, job, setup, staff, ws } from './factories/meta-inbox-harness.js';

// Spec §7: a newer customer message interrupts the turn, which is re-run with the carried tool work.

describe('MetaInboxProcessor — interrupt', () => {
  it('reports a newer customer message or a takeover through shouldInterrupt', async () => {
    const { ai, channels, takeOver, run } = setup();
    const seen: boolean[] = [];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      seen.push(await options.shouldInterrupt!());
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValueOnce(true);
      seen.push(await options.shouldInterrupt!());
      await takeOver();
      seen.push(await options.shouldInterrupt!());
      return answer('x');
    });
    await run(job('i1', 'hi'));
    expect(seen).toEqual([false, true, true]);
  });

  it('re-runs an interrupted turn with every customer message and the carry, as given', async () => {
    const { ai, channels, keys, texts, run } = setup();
    const carry = [{ role: 'assistant' as const, content: 'tool work' }];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Dạ em xem ạ', images: [] });
      return { ...answer(''), interrupted: true, carry } as Partial<ReplyResult>;
    });
    const first = job('i2', 'giày size 40 còn không?');
    await run(first);
    expect(channels.requeueEvent).toHaveBeenCalledTimes(1);
    expect(channels.completeEvent).not.toHaveBeenCalled();
    ai.reply.mockResolvedValueOnce(answer('Còn ạ, màu đen nhé'));
    await run({ ...first, attempt: 1 }, job('i3', 'màu đen nhé'));
    const [, , req, options] = ai.reply.mock.calls[1]!;
    expect(options.carry).toBe(carry);
    // The interrupted run's own message is in the carry, not repeated as history.
    expect(req.messages).toEqual([
      { role: 'customer', content: 'giày size 40 còn không?\nmàu đen nhé' },
    ]);
    expect(keys()).toEqual(['bot:i2:s1', 'bot:i3']);
    expect(texts().at(-1)).toBe('Còn ạ, màu đen nhé');
  });

  it('re-runs at most 3 times per burst, then lets the last run finish', async () => {
    const { ai, channels, keys, run } = setup();
    let n = 0;
    ai.reply.mockImplementation(async (_w, _b, _req, options) => {
      if (!options.shouldInterrupt) return answer('Xong ạ');
      n++;
      return { ...answer(''), interrupted: true, carry: [{ role: 'assistant', content: `c${n}` }] };
    });
    const again = job('i4', 'hi');
    for (let i = 0; i < 4; i++) await run({ ...again });
    expect(channels.requeueEvent).toHaveBeenCalledTimes(3);
    const calls = ai.reply.mock.calls.map((c) => c[3]);
    expect(calls.map((o) => Boolean(o.shouldInterrupt))).toEqual([true, true, true, false]);
    // Each re-run gets the previous run's carry exactly, never a concatenation.
    expect(calls.map((o) => o.carry?.map((m) => m.content))).toEqual([
      undefined,
      ['c1'],
      ['c2'],
      ['c3'],
    ]);
    expect(keys()).toEqual(['bot:i4']);
    expect(channels.completeEvent).toHaveBeenCalledTimes(1);
  });

  it('does not re-run a turn interrupted by a takeover', async () => {
    const { ai, channels, takeOver, run } = setup();
    ai.reply.mockImplementationOnce(async () => {
      await takeOver();
      return { ...answer(''), interrupted: true, carry: [] };
    });
    await run(job('i5', 'hi'));
    expect(channels.requeueEvent).not.toHaveBeenCalled();
    expect(channels.completeEvent).toHaveBeenCalledTimes(1);
    expect(channels.deliver).not.toHaveBeenCalled();
  });
});

describe('MetaInboxProcessor — re-run state (fix round 1)', () => {
  it('keeps a finished run’s sends in the history when its final is dropped for a newer message', async () => {
    const { ai, channels, run } = setup();
    const c1 = [{ role: 'assistant' as const, content: 'tool work 1' }];
    // Run 1: sends S1, interrupted with a fresh carry.
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Dạ em gửi ảnh', images: [] });
      return { ...answer(''), interrupted: true, carry: c1 } as Partial<ReplyResult>;
    });
    const first = job('k1', 'cho xem giày');
    await run(first);
    // Run 2: gets c1, sends S2 and finishes, but the customer wrote again before its final.
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Mẫu này còn size 40', images: [] });
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      return answer('Anh lấy size nào ạ?');
    });
    const second = job('k2', 'size 40 nhé');
    await run({ ...first }, second);
    vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(false);
    ai.reply.mockResolvedValueOnce(answer('Dạ em lên đơn ạ'));
    await run({ ...second }, job('k3', 'giao luôn'));
    expect(channels.requeueEvent).toHaveBeenCalledTimes(2);
    const [, , req2, options2] = ai.reply.mock.calls[1]!;
    expect(options2.carry).toBe(c1);
    expect(req2.messages).toEqual([{ role: 'customer', content: 'cho xem giày\nsize 40 nhé' }]);
    const [, , req3, options3] = ai.reply.mock.calls[2]!;
    // No stale carry: both runs' sends are plain history now.
    expect(options3.carry).toBeUndefined();
    expect(req3.messages).toEqual([
      { role: 'customer', content: 'cho xem giày' },
      { role: 'bot', content: 'Dạ em gửi ảnh' },
      { role: 'customer', content: 'size 40 nhé' },
      { role: 'bot', content: 'Mẫu này còn size 40' },
      { role: 'customer', content: 'giao luôn' },
    ]);
  });

  it('retries the event (no silent drop) when the first send throws before anything was stored', async () => {
    const { ai, billing, channels, inbox, run } = setup();
    vi.spyOn(inbox, 'commitBotReply').mockRejectedValueOnce(new Error('db down'));
    const results: { delivered: number }[] = [];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      results.push(await options.sink!.send({ text: 'A', images: [] }));
      return answer('B');
    });
    await run(job('f1', 'hi'));
    expect(results).toEqual([{ delivered: 0, complete: false }]);
    expect(channels.deliver).not.toHaveBeenCalled();
    expect(channels.completeEvent).not.toHaveBeenCalled();
    expect(channels.releaseEvent).toHaveBeenCalledTimes(1);
    // Nothing was delivered: the reservation is given back.
    expect(billing.releaseReply).toHaveBeenCalledWith(ws, 'bot:f1');
    expect(billing.captureReply).not.toHaveBeenCalled();
  });

  it('keeps the pending re-run when an echo is claimed alone before it', async () => {
    const { ai, channels, run } = setup();
    const carry = [{ role: 'assistant' as const, content: 'tool work' }];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Dạ em xem ạ', images: [] });
      return { ...answer(''), interrupted: true, carry } as Partial<ReplyResult>;
    });
    const first = job('e1', 'còn hàng không?');
    await run(first);
    // Meta's echo of the run's own send (delivered as `sent1`) arrives in a tick of its own.
    const echo = job('sent1', 'Dạ em xem ạ');
    await run({ ...echo, event: { ...echo.event, type: 'echo' } });
    expect(ai.reply).toHaveBeenCalledTimes(1);
    ai.reply.mockResolvedValueOnce(answer('Còn ạ'));
    await run({ ...first }, job('e2', 'màu đen'));
    expect(ai.reply.mock.calls[1]![3].carry).toBe(carry);
    expect(channels.requeueEvent).toHaveBeenCalledTimes(1);
  });

  it('keeps the pending re-run when the old event is claimed alone after a newer message', async () => {
    const { ai, inbox, run } = setup();
    const carry = [{ role: 'assistant' as const, content: 'tool work' }];
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'Dạ em xem ạ', images: [] });
      return { ...answer(''), interrupted: true, carry } as Partial<ReplyResult>;
    });
    const first = job('e1', 'còn hàng không?');
    await run(first);
    // e2 is stored (still in its quiet window) when the requeued e1 is claimed on its own.
    const second = job('e2', 'màu đen');
    await inbox.receive(second.workspaceId, second.connectionId, second.event);
    await run({ ...first });
    expect(ai.reply).toHaveBeenCalledTimes(1);
    ai.reply.mockResolvedValueOnce(answer('Còn ạ'));
    await run(second);
    expect(ai.reply.mock.calls[1]![3].carry).toBe(carry);
  });

  it('drops a pending re-run when staff took over and handed back before it ran', async () => {
    const { ai, inbox, run, conversationId } = setup();
    ai.reply.mockImplementationOnce(async () => ({
      ...answer(''),
      interrupted: true,
      carry: [{ role: 'assistant', content: 'old work' }],
    }));
    const first = job('h1', 'hi');
    await run(first);
    const id = await conversationId();
    await inbox.send(
      ws,
      id,
      { text: 'Staff here', idempotencyKey: '018d0000-0000-7000-8000-0000000000aa' },
      staff,
    );
    await inbox.update(ws, id, { mode: 'bot' }, staff);
    ai.reply.mockResolvedValueOnce(answer('ok'));
    await run({ ...first }, job('h2', 'still there?'));
    const [, , req, options] = ai.reply.mock.calls[1]!;
    expect(options.carry).toBeUndefined();
    expect(options.shouldInterrupt).toBeDefined();
    expect(req.messages.map((m) => m.content)).toContain('Staff here');
  });

  it('drops a pending re-run when its event is skipped during a takeover', async () => {
    const { ai, inbox, run, takeOver, conversationId } = setup();
    ai.reply.mockImplementationOnce(async () => ({
      ...answer(''),
      interrupted: true,
      carry: [{ role: 'assistant', content: 'old work' }],
    }));
    const first = job('h3', 'hi');
    await run(first);
    await takeOver();
    await run({ ...first }); // skipped: the conversation is not on the bot
    await inbox.update(ws, await conversationId(), { mode: 'bot' }, staff);
    ai.reply.mockResolvedValueOnce(answer('ok'));
    await run(job('h4', 'hello again'));
    expect(ai.reply).toHaveBeenCalledTimes(2);
    expect(ai.reply.mock.calls[1]![3].carry).toBeUndefined();
  });

  it('sends the final answer when the newer message that stopped the sends is gone after the run', async () => {
    const { ai, channels, keys, run } = setup();
    ai.reply.mockImplementationOnce(async (_w, _b, _req, options) => {
      await options.sink!.send({ text: 'A', images: [] });
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValueOnce(true);
      await options.sink!.send({ text: 'B', images: [] });
      return answer('C');
    });
    await run(job('g1', 'hi'));
    expect(keys()).toEqual(['bot:g1:s1', 'bot:g1']);
    expect(channels.requeueEvent).not.toHaveBeenCalled();
  });
});

describe('MetaInboxProcessor — dropped finals (final review)', () => {
  it('never drops a hand-off final: it goes out whole and staff take over', async () => {
    const { ai, channels, inbox, keys, texts, run, conversationId } = setup();
    ai.reply.mockImplementationOnce(async () => {
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      return answer('Dạ em chuyển nhân viên ạ. Anh đợi chút nhé!', { outcome: 'handoff' });
    });
    await run(job('d1', 'cho gặp nhân viên'));
    expect(channels.requeueEvent).not.toHaveBeenCalled();
    expect(keys()).toEqual(['bot:d1', 'bot:d1:t2']);
    expect(texts()).toEqual(['Dạ em chuyển nhân viên ạ.', 'Anh đợi chút nhé!']);
    expect(await inbox.botHolds(ws, await conversationId())).toBe(false);
  });

  it('clears an unseen confirmation question when the final is dropped for a newer message', async () => {
    const { ai, channels, run, conversationId } = setup();
    ai.reply.mockImplementationOnce(async () => {
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      return answer('Em đặt đơn size 40 nhé, anh xác nhận giúp em?', { askedConfirmation: true });
    });
    await run(job('d2', 'đặt giày'));
    expect(channels.requeueEvent).toHaveBeenCalledTimes(1);
    expect(channels.deliver).not.toHaveBeenCalled();
    expect(ai.discardPendingConfirmation).toHaveBeenCalledWith(ws, await conversationId());
  });

  it('clears an unseen confirmation question when a takeover drops the final', async () => {
    const { ai, channels, takeOver, run, conversationId } = setup();
    ai.reply.mockImplementationOnce(async () => {
      await takeOver();
      return answer('Anh xác nhận giúp em?', { askedConfirmation: true });
    });
    await run(job('d3', 'đặt giày'));
    expect(channels.deliver).not.toHaveBeenCalled();
    expect(ai.discardPendingConfirmation).toHaveBeenCalledWith(ws, await conversationId());
  });

  it('keeps the confirmation question when the final went out, or when none was asked', async () => {
    const { ai, channels, run } = setup();
    ai.reply.mockResolvedValueOnce(answer('Anh xác nhận giúp em?', { askedConfirmation: true }));
    await run(job('d4', 'đặt giày'));
    ai.reply.mockImplementationOnce(async () => {
      vi.mocked(channels.hasNewerCustomerEvent).mockResolvedValue(true);
      return answer('Dạ còn ạ');
    });
    await run(job('d5', 'còn không'));
    expect(channels.requeueEvent).toHaveBeenCalledTimes(1);
    expect(ai.discardPendingConfirmation).not.toHaveBeenCalled();
  });
});
