import type { NormalizedEvent } from '@agent-sales/channels';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AiFacade } from '../../ai/api/index.js';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { ChannelFacade, PendingMetaEvent } from '../../channel/api/index.js';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { MetaInboxProcessor } from '../application/jobs/meta-inbox.processor.js';
import { MemoryConversationStore } from './factories/memory-conversation-store.js';

const ws = workspaceId('018d0000-0000-7000-8000-000000000001');
const channelId = '018d0000-0000-7000-8000-000000000003';
const botId = '018d0000-0000-7000-8000-000000000004';
let seq = 0;
function job(
  id: string,
  type: 'message' | 'echo',
  text: string,
  at: number,
  attempt = 1,
  attachments: NormalizedEvent['attachments'] = undefined,
): PendingMetaEvent {
  const event: NormalizedEvent = {
    kind: 'facebook',
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: 'customer',
    type,
    occurredAt: new Date(at),
    text,
    ...(attachments ? { attachments } : {}),
    raw: {},
  };
  return {
    id: `job-${++seq}`,
    claimToken: 't',
    workspaceId: ws,
    connectionId: channelId,
    attempt,
    event,
  };
}
function setup() {
  const bot = {
    id: botId,
    isActive: true,
    silenceOnExternalReply: true,
    handoffMessage: 'Staff will help you',
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
    claimEvents: vi.fn(async () => [] as PendingMetaEvent[]),
    renewEvent: async () => true,
    completeEvent: vi.fn(async () => undefined),
    releaseEvent: vi.fn(async () => undefined),
    deadLetterEvent: vi.fn(async () => undefined),
    deadLetterExhaustedEvents: vi.fn(async () => [] as string[]),
  } as unknown as ChannelFacade & { claimEvents: ReturnType<typeof vi.fn> };
  const bots: BotFacade = { getBot: async () => bot };
  const inbox = new ConversationFacadeImpl(new MemoryConversationStore(), channels, bots);
  const ai = {
    reply: vi.fn(async (_ws: unknown, _bot: unknown, req: { messages: { content: string }[] }) => ({
      reply: `re: ${req.messages.at(-1)?.content}`,
      outcome: 'answered',
    })),
  } as unknown as AiFacade & { reply: ReturnType<typeof vi.fn> };
  return {
    bot,
    channels,
    ai,
    inbox,
    processor: new MetaInboxProcessor(channels, inbox, ai, bots),
  };
}

describe('MetaInboxProcessor', () => {
  it('answers a message that arrived while the previous reply was being generated', async () => {
    const { channels, ai, processor } = setup();
    const t0 = Date.now();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([job('m1', 'message', 'first', t0)]);
    await processor.tick();
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    // m2 was sent before our reply's echo but is only claimed now, together with that echo.
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('m2', 'message', 'second', t0 + 1000),
      job('sent1', 'echo', 're: first', t0 + 2000),
    ]);
    await processor.tick();
    expect(channels.deliver).toHaveBeenCalledTimes(2);
    expect(ai.reply).toHaveBeenLastCalledWith(
      ws,
      botId,
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'customer', content: 'second' }]),
      }),
      expect.anything(),
    );
  });
  it('still answers the text of a burst that ends with an attachment-only message', async () => {
    const { channels, processor } = setup();
    const t0 = Date.now();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('a1', 'message', 'is this in stock?', t0),
      job('a2', 'message', '', t0 + 500),
    ]);
    await processor.tick();
    expect(channels.deliver).toHaveBeenCalledTimes(1);
  });

  it('answers a parallel burst whose Meta timestamps disagree with arrival order', async () => {
    const { channels, ai, processor } = setup();
    const t0 = Date.now();
    // Claim (arrival) order is a, b, c; Meta stamped them c, a, b.
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('a', 'message', 'Shop ơi', t0 - 2000),
      job('b', 'message', 'mua giày', t0 - 3000),
      job('c', 'message', 'size 41 giá bao nhiêu', t0 - 1000 - 5000),
    ]);
    await processor.tick();
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    expect(ai.reply).toHaveBeenCalledTimes(1);
    expect(ai.reply.mock.calls[0]?.[2].messages).toEqual([
      { role: 'customer', content: 'Shop ơi\nmua giày\nsize 41 giá bao nhiêu' },
    ]);
  });
  it('orders messages received within the same millisecond by arrival', async () => {
    const { channels, ai, processor } = setup();
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-24T03:00:00Z'));
      const t0 = Date.now();
      vi.mocked(channels.claimEvents).mockResolvedValueOnce(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => job(`x${k}`, 'message', k, t0 - 100)),
      );
      await processor.tick();
      expect(channels.deliver).toHaveBeenCalledTimes(1);
      expect(ai.reply.mock.calls[0]?.[2].messages.at(-1).content).toBe('a\nb\nc\nd\ne\nf');
    } finally {
      vi.useRealTimers();
    }
  });
  it('shows the model a late burst after the earlier reply, newest customer turn last', async () => {
    const { channels, ai, processor } = setup();
    const t0 = Date.now();
    // Claim debounce: the first message is answered alone, the rest are claimed in the next tick.
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('m1', 'message', 'Chào shop', t0 - 9000),
    ]);
    await processor.tick();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('m2', 'message', 'mình muốn mua giày da', t0 - 7800),
      job('m3', 'message', 'Oxford size 41 giá bao nhiêu?', t0 - 6600),
      job('sent1', 'echo', 're: Chào shop', t0 - 1000),
    ]);
    await processor.tick();
    expect(channels.deliver).toHaveBeenCalledTimes(2);
    expect(ai.reply.mock.calls[1]?.[2].messages).toEqual([
      { role: 'customer', content: 'Chào shop' },
      { role: 'bot', content: 're: Chào shop' },
      { role: 'customer', content: 'mình muốn mua giày da\nOxford size 41 giá bao nhiêu?' },
    ]);
  });
  it('gives the model every question of a parallel burst as one customer turn, answered once', async () => {
    const { channels, ai, inbox, processor } = setup();
    const t0 = Date.now();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('p1', 'message', 'Chào shop', t0),
      job('p2', 'message', 'Giày da Oxford giá bao nhiêu?', t0 + 300),
      job('p3', 'message', 'Phí ship bao nhiêu?', t0 + 1500),
    ]);
    await processor.tick();
    expect(ai.reply).toHaveBeenCalledTimes(1);
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    const turns = ai.reply.mock.calls[0]?.[2].messages;
    expect(turns).toHaveLength(1);
    for (const q of ['Chào shop', 'Giày da Oxford giá bao nhiêu?', 'Phí ship bao nhiêu?'])
      expect(turns[0].content).toContain(q);
    expect(turns[0].content.indexOf('Oxford')).toBeLessThan(turns[0].content.indexOf('ship'));
    // Every claimed event is completed exactly once; none is left to be answered again.
    expect(channels.completeEvent).toHaveBeenCalledTimes(3);
    const [c] = (await inbox.list(ws, { limit: 10 } as never)).data;
    const outbound = (await inbox.get(ws, c!.id)).messages.filter(
      (m) => m.direction === 'outbound',
    );
    expect(outbound).toHaveLength(1);
  });
  it('keeps the earlier question when the burst straddles a claim tick', async () => {
    const { channels, ai, processor } = setup();
    const t0 = Date.now();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('s1', 'message', 'Giày da Oxford giá bao nhiêu?', t0),
    ]);
    await processor.tick();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('s2', 'message', 'Phí ship bao nhiêu?', t0 + 1200),
      job('sent1', 'echo', 're: Giày da Oxford giá bao nhiêu?', t0 + 1300),
    ]);
    await processor.tick();
    expect(ai.reply).toHaveBeenCalledTimes(2);
    expect(channels.deliver).toHaveBeenCalledTimes(2);
    expect(ai.reply.mock.calls[0]?.[2].messages.at(-1).content).toContain('Oxford');
    expect(ai.reply.mock.calls[1]?.[2].messages).toEqual([
      { role: 'customer', content: 'Giày da Oxford giá bao nhiêu?' },
      { role: 'bot', content: 're: Giày da Oxford giá bao nhiêu?' },
      { role: 'customer', content: 'Phí ship bao nhiêu?' },
    ]);
  });
  it('answers all earlier text when the newest event of the burst is an image, with no extra handoff', async () => {
    const { channels, ai, inbox, processor } = setup();
    const t0 = Date.now();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('i1', 'message', 'Giày da Oxford giá bao nhiêu?', t0),
      job('i2', 'message', 'Phí ship bao nhiêu?', t0 + 600),
      job('i3', 'message', '', t0 + 1200, 1, [{ type: 'image', url: 'https://cdn.example/a.jpg' }]),
    ]);
    await processor.tick();
    expect(ai.reply).toHaveBeenCalledTimes(1);
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    const turns = ai.reply.mock.calls[0]?.[2].messages;
    expect(turns).toHaveLength(1);
    expect(turns[0].content).toContain('Oxford');
    expect(turns[0].content).toContain('ship');
    expect(turns[0].content.match(/Khách đã gửi kèm 1 ảnh/g)).toHaveLength(1);
    const [c] = (await inbox.list(ws, { limit: 10 } as never)).data;
    expect(c?.mode).toBe('bot');
  });
  it('hands an attachment-only message to staff with the handoff message', async () => {
    const { channels, ai, inbox, processor } = setup();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('img', 'message', '', Date.now(), 1, [
        { type: 'image', url: 'https://cdn.example/a.jpg' },
      ]),
    ]);
    await processor.tick();
    expect(ai.reply).not.toHaveBeenCalled();
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    expect(channels.deliver).toHaveBeenCalledWith(
      ws,
      channelId,
      'customer',
      { text: 'Staff will help you' },
      'bot:img',
    );
    const [c] = (await inbox.list(ws, { limit: 10 } as never)).data;
    expect(c?.mode).toBe('human');
    expect(channels.completeEvent).toHaveBeenCalled();
  });
  it('tells the model when a text message came with an image', async () => {
    const { channels, ai, processor } = setup();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('it', 'message', 'Mình muốn mua đôi giống này', Date.now(), 1, [
        { type: 'image', url: 'https://cdn.example/a.jpg' },
      ]),
    ]);
    await processor.tick();
    const last = ai.reply.mock.calls[0]?.[2].messages.at(-1);
    expect(last.role).toBe('customer');
    expect(last.content).toContain('Mình muốn mua đôi giống này');
    expect(last.content).toContain('Khách đã gửi kèm 1 ảnh');
  });
  it('answers the text of a burst that ends with an image and notes the image', async () => {
    const { channels, ai, processor } = setup();
    const t0 = Date.now();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('t1', 'message', 'giày này còn không?', t0 - 2000),
      job('t2', 'message', '', t0 - 1000, 1, [{ type: 'image', url: 'https://cdn.example/a.jpg' }]),
    ]);
    await processor.tick();
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    expect(ai.reply).toHaveBeenCalledTimes(1);
    const contents = ai.reply.mock.calls[0]?.[2].messages.map(
      (m: { content: string }) => m.content,
    );
    expect(contents).toHaveLength(1);
    expect(contents[0]).toContain('giày này còn không?');
    expect(contents[0]).toContain('Khách đã gửi kèm 1 ảnh');
  });
  it('hands the conversation to staff when the final retry fails', async () => {
    const { channels, ai, inbox, processor } = setup();
    vi.mocked(ai.reply).mockRejectedValue(new Error('busy'));
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('r1', 'message', 'hi', Date.now(), 1),
    ]);
    await processor.tick();
    const [c] = (await inbox.list(ws, { limit: 10 } as never)).data;
    expect(c?.mode).toBe('bot');
    expect(channels.releaseEvent).toHaveBeenCalledWith(expect.any(String), 't', 20_000);
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('r1', 'message', 'hi', Date.now(), 3),
    ]);
    await processor.tick();
    expect((await inbox.get(ws, c!.id)).conversation.mode).toBe('human');
    expect(channels.completeEvent).toHaveBeenCalled();
  });
  it('dead-letters an event that cannot even be stored after the final attempt', async () => {
    const { channels, processor } = setup();
    vi.mocked(channels.getConnection).mockRejectedValue(new Error('db down'));
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('d1', 'message', 'hi', Date.now(), 1),
    ]);
    await processor.tick();
    expect(channels.releaseEvent).toHaveBeenCalledWith(expect.any(String), 't', 20_000);
    expect(channels.deadLetterEvent).not.toHaveBeenCalled();
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('d1', 'message', 'hi', Date.now(), 3),
    ]);
    await processor.tick();
    expect(channels.deadLetterEvent).toHaveBeenCalledWith(expect.any(String), 't');
    expect(channels.releaseEvent).toHaveBeenCalledTimes(1);
  });
  it('sweeps exhausted events into the dead letter before claiming new ones', async () => {
    const { channels, processor } = setup();
    await processor.tick();
    expect(channels.deadLetterExhaustedEvents).toHaveBeenCalledTimes(1);
  });
  it('stores messages for staff but does not reply while the connection awaits re-auth', async () => {
    const { channels, ai, inbox, processor } = setup();
    vi.mocked(channels.getConnection).mockResolvedValue({
      id: channelId,
      provider: 'facebook',
      externalId: 'page',
      name: 'Page',
      status: 'reauth_required',
      botId,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    });
    vi.mocked(channels.claimEvents).mockResolvedValueOnce([
      job('ra', 'message', 'hello?', Date.now()),
    ]);
    await processor.tick();
    const [c] = (await inbox.list(ws, { limit: 10 } as never)).data;
    expect((await inbox.get(ws, c!.id)).messages.map((m) => m.text)).toEqual(['hello?']);
    expect(ai.reply).not.toHaveBeenCalled();
    expect(channels.completeEvent).toHaveBeenCalled();
  });
  it('leaves messages outside the reply hours to staff', async () => {
    const { bot, channels, ai, processor } = setup();
    bot.replySchedule = { mode: 'custom', start: '08:00', end: '17:00' };
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-24T12:00:00Z')); // 19:00 in Vietnam
      vi.mocked(channels.claimEvents).mockResolvedValueOnce([
        job('late', 'message', 'still open?', Date.now()),
      ]);
      await processor.tick();
      expect(ai.reply).not.toHaveBeenCalled();
      expect(channels.completeEvent).toHaveBeenCalled();
      vi.setSystemTime(new Date('2026-10-25T02:00:00Z')); // 09:00 in Vietnam
      vi.mocked(channels.claimEvents).mockResolvedValueOnce([
        job('morning', 'message', 'hello', Date.now()),
      ]);
      await processor.tick();
      expect(channels.deliver).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
