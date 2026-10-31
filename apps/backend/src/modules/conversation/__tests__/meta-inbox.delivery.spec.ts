import type { NormalizedEvent } from '@agent-sales/channels';
import { workspaceId } from '@agent-sales/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AiFacade, ReplyOptions, ReplyResult } from '../../ai/api/index.js';
import type { BillingFacade } from '../../billing/api/index.js';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { ChannelFacade, PendingMetaEvent } from '../../channel/api/index.js';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { MetaInboxProcessor } from '../application/jobs/meta-inbox.processor.js';
import { type ReplyPacing, SEND_GAP_MS } from '../application/jobs/reply-delivery.js';
import { fakeBilling, fakeCrm, fakeIdentity, fakeTeam } from './fakes.js';
import { MemoryConversationStore } from './factories/memory-conversation-store.js';

// Spec §7: `send_message` output is delivered as it is sent (through the turn's sink), paced, and
// a newer customer message interrupts the turn, which is re-run with the carried tool work.

const ws = workspaceId('018d0000-0000-7000-8000-000000000001');
const channelId = '018d0000-0000-7000-8000-000000000003';
const botId = '018d0000-0000-7000-8000-000000000004';
const staff = '018d0000-0000-7000-8000-000000000005';
const pics = [
  { id: 'i1', url: 'https://img.example.com/1.jpg', label: 'one' },
  { id: 'i2', url: 'https://img.example.com/2.jpg', label: 'two' },
];
let seq = 0;

function job(id: string, text: string, at = Date.now()): PendingMetaEvent {
  const event: NormalizedEvent = {
    kind: 'facebook',
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: 'customer',
    type: 'message',
    occurredAt: new Date(at),
    text,
    raw: {},
  };
  return {
    id: `dj-${++seq}`,
    claimToken: 't',
    workspaceId: ws,
    connectionId: channelId,
    attempt: 1,
    event,
  };
}

type Reply = (
  ...args: [unknown, unknown, { messages: { role: string; content: string }[] }, ReplyOptions]
) => Promise<Partial<ReplyResult>>;

function answer(final: string, extra: Partial<ReplyResult> = {}): Partial<ReplyResult> {
  return {
    reply: final,
    outcome: 'answered',
    images: [],
    messages: final ? [{ text: final, images: [], via: 'final' }] : [],
    ...extra,
  };
}

function setup(pacing?: ReplyPacing) {
  const bot = {
    id: botId,
    isActive: true,
    silenceOnExternalReply: true,
    handoffMessage: 'Staff will help you',
    fallbackMessage: 'Shop will get back to you',
    language: 'vi',
    selfPronoun: 'em',
    customerPronoun: 'anh/chị',
  } as BotView;
  let sent = 0;
  const channels = {
    getConnection: vi.fn(async () => ({
      id: channelId,
      provider: 'facebook' as const,
      externalId: 'page',
      name: 'Page',
      status: 'connected' as const,
      botId,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    })),
    deliver: vi.fn(async () => ({
      externalId: `sent${++sent}`,
      status: 'sent' as const,
      failureCode: null,
    })),
    fetchCustomerProfile: vi.fn(async () => null),
    claimEvents: vi.fn(async () => [] as PendingMetaEvent[]),
    renewEvent: async () => true,
    completeEvent: vi.fn(async () => undefined),
    releaseEvent: vi.fn(async () => undefined),
    deadLetterEvent: vi.fn(async () => undefined),
    deadLetterExhaustedEvents: vi.fn(async () => [] as string[]),
    presence: vi.fn(async () => undefined),
    requeueEvent: vi.fn(async () => undefined),
    hasNewerCustomerEvent: vi.fn(async () => false),
    unbindBot: vi.fn(async () => 0),
  } as unknown as ChannelFacade & { claimEvents: ReturnType<typeof vi.fn> };
  const bots: BotFacade = { getBot: async () => bot };
  const inbox = new ConversationFacadeImpl(
    new MemoryConversationStore(),
    channels,
    bots,
    fakeTeam(),
    fakeIdentity(),
    fakeCrm() as never,
  );
  const ai = { reply: vi.fn<Reply>(async () => answer('ok')) };
  const sleeps: number[] = [];
  let clock = 0;
  const recorder: ReplyPacing = {
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  };
  const processor = new MetaInboxProcessor(
    channels,
    inbox,
    ai as unknown as AiFacade,
    bots,
    fakeBilling() as unknown as BillingFacade,
    { fetch: async () => null },
    false,
    undefined,
    pacing ?? recorder,
  );
  const keys = () => vi.mocked(channels.deliver).mock.calls.map((c) => c[4]);
  const texts = () => vi.mocked(channels.deliver).mock.calls.map((c) => c[3].text);
  const takeOver = async () => {
    const [c] = (await inbox.list(ws, { limit: 10 } as never)).data;
    await inbox.update(ws, c!.id, { mode: 'human' }, staff);
  };
  const run = async (...jobs: PendingMetaEvent[]) => {
    vi.mocked(channels.claimEvents).mockResolvedValueOnce(jobs);
    await processor.tick();
  };
  return { channels, inbox, ai, processor, sleeps, keys, texts, takeOver, run };
}

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
