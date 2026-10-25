import type { NormalizedEvent } from '@agent-sales/channels';
import { workspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';
import type { AiFacade } from '../../ai/api/index.js';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { ChannelFacade, PendingMetaEvent } from '../../channel/api/index.js';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { MetaInboxProcessor } from '../application/jobs/meta-inbox.processor.js';
import { fakeIdentity, fakeTeam } from './fakes.js';
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
  const bot = { id: botId, isActive: true, silenceOnExternalReply: true } as BotView;
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
  const inbox = new ConversationFacadeImpl(
    new MemoryConversationStore(),
    channels,
    bots,
    fakeTeam(),
    fakeIdentity(),
  );
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
