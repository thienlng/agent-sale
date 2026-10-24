import { newId, workspaceId } from '@agent-sales/shared';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { ChannelFacade } from '../../channel/api/index.js';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { MemoryConversationStore } from './factories/memory-conversation-store.js';
const ws = workspaceId('018d0000-0000-7000-8000-000000000001'),
  other = workspaceId('018d0000-0000-7000-8000-000000000002');
const channelId = '018d0000-0000-7000-8000-000000000003',
  botId = '018d0000-0000-7000-8000-000000000004',
  actor = '018d0000-0000-7000-8000-000000000005';
let service: ConversationFacadeImpl,
  store: MemoryConversationStore,
  channels: ChannelFacade,
  bot: BotView;
function event(id = 'in1', type: 'message' | 'echo' = 'message'): NormalizedEvent {
  return {
    kind: 'facebook',
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: 'customer',
    type,
    occurredAt: new Date(),
    text: 'Hello',
    raw: {},
  };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T05:00:00Z'));
  store = new MemoryConversationStore();
  bot = {
    id: botId,
    name: 'Bot',
    industry: 'retail',
    isActive: true,
    mission: '',
    greeting: '',
    selfPronoun: '',
    customerPronoun: '',
    fallbackMessage: '',
    handoffMessage: '',
    creativity: 'strict',
    modelTier: 'basic',
    language: 'en',
    placeholders: {},
    autoResumeAfterManual: true,
    humanTakeoverMinutes: 5,
    silenceOnExternalReply: true,
  };
  channels = {
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
      externalId: 'sent1',
      status: 'sent' as const,
      failureCode: null,
    })),
    claimEvents: async () => [],
    renewEvent: async () => true,
    completeEvent: async () => undefined,
    releaseEvent: async () => undefined,
  };
  const bots: BotFacade = { getBot: async () => bot };
  service = new ConversationFacadeImpl(store, channels, bots);
});
afterEach(() => vi.useRealTimers());
describe('ConversationFacade tenant and delivery contract', () => {
  it('deduplicates inbound messages and hides conversations from another tenant', async () => {
    const c = await service.receive(ws, channelId, event());
    await service.receive(ws, channelId, event());
    expect((await service.get(ws, c.id)).messages).toHaveLength(1);
    await expect(service.get(other, c.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.update(other, c.id, { note: 'steal' }, actor)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(
      service.send(other, c.id, { text: 'steal', idempotencyKey: newId() }, actor),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(channels.deliver).not.toHaveBeenCalled();
  });
  it('sends once, atomically pauses the bot and keeps the same result on a repeated request', async () => {
    const c = await service.receive(ws, channelId, event());
    const body = { text: 'A human reply', idempotencyKey: newId() };
    const first = await service.send(ws, c.id, body, actor);
    const second = await service.send(ws, c.id, body, actor);
    expect(second).toEqual(first);
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    expect((await service.get(ws, c.id)).conversation).toMatchObject({
      mode: 'human',
      assigneeId: actor,
      autoResumeAt: '2026-10-24T05:05:00.000Z',
    });
    expect(store.events.length).toBeGreaterThanOrEqual(3);
    await expect(
      service.send(ws, c.id, { ...body, text: 'different' }, actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });
  it('keeps uncertain deliveries visible and never resends them', async () => {
    vi.mocked(channels.deliver).mockResolvedValue({
      externalId: null,
      status: 'unknown',
      failureCode: 'delivery_unknown',
    });
    const c = await service.receive(ws, channelId, event());
    const body = { text: 'reply', idempotencyKey: newId() };
    expect((await service.send(ws, c.id, body, actor)).status).toBe('unknown');
    expect((await service.send(ws, c.id, body, actor)).status).toBe('unknown');
    expect(channels.deliver).toHaveBeenCalledTimes(1);
  });
  it('suppresses stale bot replies after takeover or a newer customer message', async () => {
    const c = await service.receive(ws, channelId, event());
    const context = await service.getReplyContext(ws, c.id);
    await service.update(ws, c.id, { mode: 'human' }, actor);
    expect(
      await service.commitBotReply(ws, c.id, {
        revision: context.revision,
        text: 'stale',
        idempotencyKey: 'bot:in1',
      }),
    ).toBeNull();
    await service.update(ws, c.id, { mode: 'bot' }, actor);
    const before = await service.getReplyContext(ws, c.id);
    await service.receive(ws, channelId, event('in2'));
    expect(
      await service.commitBotReply(ws, c.id, {
        revision: before.revision,
        text: 'stale',
        idempotencyKey: 'bot:in2',
      }),
    ).toBeNull();
    expect(channels.deliver).not.toHaveBeenCalled();
  });
  it('suppresses bot replies when the bot was disabled during generation', async () => {
    const c = await service.receive(ws, channelId, event());
    bot.isActive = false;
    expect(
      await service.commitBotReply(ws, c.id, {
        revision: c.revision,
        text: 'reply',
        idempotencyKey: 'bot:in1',
      }),
    ).toBeNull();
    expect(channels.deliver).not.toHaveBeenCalled();
  });
  it('rejects a closed 24-hour window without calling the provider', async () => {
    const c = await service.receive(ws, channelId, event());
    vi.advanceTimersByTime(86400000);
    await expect(
      service.send(ws, c.id, { text: 'too late', idempotencyKey: newId() }, actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(channels.deliver).not.toHaveBeenCalled();
  });
  it('auto-resumes on the next inbound only after the configured human pause', async () => {
    const c = await service.receive(ws, channelId, event());
    await service.send(ws, c.id, { text: 'human', idempotencyKey: newId() }, actor);
    vi.advanceTimersByTime(4 * 60000);
    expect((await service.receive(ws, channelId, event('in2'))).mode).toBe('human');
    vi.advanceTimersByTime(2 * 60000);
    expect((await service.receive(ws, channelId, event('in3'))).mode).toBe('bot');
  });
  it('honors indefinite manual pauses and the external-reply silence setting', async () => {
    bot.autoResumeAfterManual = false;
    const c = await service.receive(ws, channelId, event());
    await service.send(ws, c.id, { text: 'human', idempotencyKey: newId() }, actor);
    expect((await service.get(ws, c.id)).conversation.autoResumeAt).toBeNull();
    vi.advanceTimersByTime(3600000);
    expect((await service.receive(ws, channelId, event('in2'))).mode).toBe('human');
    await service.update(ws, c.id, { mode: 'bot' }, actor);
    bot.silenceOnExternalReply = false;
    expect((await service.receive(ws, channelId, event('echo1', 'echo'))).mode).toBe('bot');
    bot.silenceOnExternalReply = true;
    expect((await service.receive(ws, channelId, event('echo2', 'echo'))).mode).toBe('human');
  });
  it('does not pause automation for the bot own echoed message', async () => {
    const c = await service.receive(ws, channelId, event());
    await service.commitBotReply(ws, c.id, {
      revision: c.revision,
      text: 'reply',
      idempotencyKey: 'bot:in1',
    });
    expect((await service.receive(ws, channelId, event('sent1', 'echo'))).mode).toBe('bot');
    expect((await service.get(ws, c.id)).messages).toHaveLength(2);
  });
  it('matches the echo of an uncertain bot send instead of treating it as a staff reply', async () => {
    vi.mocked(channels.deliver).mockResolvedValue({
      externalId: null,
      status: 'unknown',
      failureCode: 'delivery_unknown',
    });
    const c = await service.receive(ws, channelId, event());
    await service.commitBotReply(ws, c.id, {
      revision: c.revision,
      text: 'Hello',
      idempotencyKey: 'bot:in1',
    });
    expect((await service.receive(ws, channelId, event('late-echo', 'echo'))).mode).toBe('bot');
    const { messages } = await service.get(ws, c.id);
    expect(messages).toHaveLength(2);
    expect(messages.find((m) => m.direction === 'outbound')).toMatchObject({
      status: 'sent',
      externalId: 'late-echo',
    });
  });
  it('does not open the 24-hour window when an echo creates the conversation', async () => {
    const c = await service.receive(ws, channelId, event('echo-first', 'echo'));
    await expect(
      service.send(ws, c.id, { text: 'hi', idempotencyKey: newId() }, actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(channels.deliver).not.toHaveBeenCalled();
  });
  it('sends an attachment by URL and rejects text plus attachment in one message', async () => {
    const c = await service.receive(ws, channelId, event());
    const attachment = { type: 'image' as const, url: 'https://cdn.example/p.jpg' };
    const sent = await service.send(
      ws,
      c.id,
      { text: '', attachment, idempotencyKey: newId() },
      actor,
    );
    expect(sent).toMatchObject({ status: 'sent', attachments: [attachment] });
    expect(channels.deliver).toHaveBeenCalledWith(
      ws,
      channelId,
      'customer',
      { text: '', attachment },
      expect.any(String),
    );
    expect((await service.get(ws, c.id)).conversation.lastMessage).toBe('[image]');
    expect(() =>
      service.send(ws, c.id, { text: 'both', attachment, idempotencyKey: newId() }, actor),
    ).toThrow();
  });
});
