import { newId, workspaceId } from '@agent-sales/shared';
import type { NormalizedEvent } from '@agent-sales/channels';
import type { ChannelFacade } from '../../channel/api/index.js';
import { type BotFacade, BotLifecycle, type BotView } from '../../bot/api/index.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { fakeCrm, fakeIdentity, fakeTeam } from './fakes.js';
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
    fetchCustomerProfile: async () => null,
    claimEvents: async () => [],
    renewEvent: async () => true,
    completeEvent: async () => undefined,
    releaseEvent: async () => undefined,
    deadLetterEvent: async () => undefined,
    deadLetterExhaustedEvents: async () => [],
    presence: async () => undefined,
    requeueEvent: async () => undefined,
    hasNewerCustomerEvent: async () => false,
    unbindBot: async () => 0,
  } as unknown as ChannelFacade;
  const bots: BotFacade = { getBot: async () => bot };
  service = new ConversationFacadeImpl(
    store,
    channels,
    bots,
    fakeTeam(),
    fakeIdentity(),
    fakeCrm() as never,
  );
});
afterEach(() => vi.useRealTimers());
describe('ConversationFacade tenant and delivery contract', () => {
  it('persists and clears a private follow-up with revision and tenant checks', async () => {
    const c = await service.receive(ws, channelId, event());
    const scheduled = await service.update(
      ws,
      c.id,
      {
        followUpAt: '2026-10-25T08:00:00Z',
        followUpNote: 'Call about size M',
        expectedRevision: c.revision,
      },
      actor,
    );
    expect((await service.get(ws, c.id)).conversation).toMatchObject({
      followUpAt: '2026-10-25T08:00:00Z',
      followUpNote: 'Call about size M',
    });
    await expect(
      service.update(ws, c.id, { followUpAt: null, expectedRevision: c.revision }, actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.update(
        other,
        c.id,
        { followUpAt: null, expectedRevision: scheduled.revision },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await service.update(
      ws,
      c.id,
      { followUpAt: null, followUpNote: '', expectedRevision: scheduled.revision },
      actor,
    );
    expect((await service.get(ws, c.id)).conversation).toMatchObject({
      followUpAt: null,
      followUpNote: '',
    });
    expect(JSON.stringify(store.events)).not.toContain('Call about size M');
    // Clearing only the time must not leave an orphan private note.
    const again = await service.update(
      ws,
      c.id,
      {
        followUpAt: '2026-10-26T08:00:00Z',
        followUpNote: 'Second',
        expectedRevision: 0 + (await service.get(ws, c.id)).conversation.revision,
      },
      actor,
    );
    await service.update(ws, c.id, { followUpAt: null, expectedRevision: again.revision }, actor);
    expect((await service.get(ws, c.id)).conversation).toMatchObject({
      followUpAt: null,
      followUpNote: '',
    });
  });

  it('rejects stale edits without overwriting notes or reassignment', async () => {
    const c = await service.receive(ws, channelId, event());
    const first = await service.update(
      ws,
      c.id,
      { note: 'First sale', expectedRevision: c.revision },
      actor,
    );
    await expect(
      service.update(ws, c.id, { note: 'Stale sale', expectedRevision: c.revision }, actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service.get(ws, c.id)).conversation.note).toBe('First sale');
    const claimed = await service.update(
      ws,
      c.id,
      { assignToMe: true, expectedRevision: first.revision },
      actor,
    );
    await expect(
      service.update(ws, c.id, { assignToMe: true, expectedRevision: first.revision }, newId()),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect((await service.get(ws, c.id)).conversation.assigneeId).toBe(claimed.assigneeId);
    await expect(
      service.update(other, c.id, { expectedRevision: first.revision }, actor),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

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
  it('keeps recording inbound messages while the connection awaits re-auth, not after disconnect', async () => {
    const base = await channels.getConnection(ws, channelId);
    vi.mocked(channels.getConnection).mockResolvedValueOnce({
      ...base,
      status: 'reauth_required' as const,
    });
    const c = await service.receive(ws, channelId, event());
    expect((await service.get(ws, c.id)).messages).toHaveLength(1);
    vi.mocked(channels.getConnection).mockResolvedValueOnce({
      ...base,
      status: 'disconnected' as const,
    });
    await expect(service.receive(ws, channelId, event('in2'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
  it('rejects events already queued for a removed page (T-133)', async () => {
    const base = await channels.getConnection(ws, channelId);
    vi.mocked(channels.getConnection).mockResolvedValueOnce({
      ...base,
      status: 'removed' as const,
    });
    await expect(service.receive(ws, channelId, event('in3'))).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
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
  it('records the bound bot on the conversation and on each event, and follows a rebind', async () => {
    type Ev = { type: string; payload: { botId?: string } };
    const c = await service.receive(ws, channelId, event());
    expect(c.botId).toBe(botId);
    await service.send(ws, c.id, { text: 'reply', idempotencyKey: newId() }, actor);
    const events = () => store.events as Ev[];
    const botsOf = (type: string) =>
      events()
        .filter((e) => e.type === type)
        .map((e) => e.payload.botId);
    expect(botsOf('conversation.message.received.v1')).toEqual([botId]);
    expect(botsOf('conversation.reply.completed.v1')).toEqual([botId]);

    const next = '018d0000-0000-7000-8000-000000000006';
    const base = await channels.getConnection(ws, channelId);
    vi.mocked(channels.getConnection).mockResolvedValue({ ...base, botId: next });
    await service.receive(ws, channelId, event('in2'));
    expect((await service.get(ws, c.id)).conversation.botId).toBe(next);
    expect(botsOf('conversation.message.received.v1')).toEqual([botId, next]);
  });

  it('detaches its conversations when the answering bot is deleted, only in that workspace', async () => {
    const lifecycle = new BotLifecycle();
    const withLifecycle = new ConversationFacadeImpl(
      store,
      channels,
      { getBot: async () => ({}) as BotView },
      fakeTeam(),
      fakeIdentity(),
      fakeCrm() as never,
      lifecycle,
    );
    withLifecycle.onModuleInit();
    const c = await service.receive(ws, channelId, event());
    expect(c.botId).toBe(botId);
    await lifecycle.beforeDelete(other, botId);
    expect((await service.get(ws, c.id)).conversation.botId).toBe(botId);
    await lifecycle.beforeDelete(ws, botId);
    expect((await service.get(ws, c.id)).conversation.botId).toBeNull();
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
  it('sends a bot image as an image attachment, once per key, only while the bot holds control', async () => {
    const c = await service.receive(ws, channelId, event());
    const reply = await service.commitBotReply(ws, c.id, {
      revision: c.revision,
      text: 'Here',
      idempotencyKey: 'bot:in1',
    });
    expect(reply?.status).toBe('sent');
    const input = { urls: ['https://img.example.com/a.jpg'], idempotencyKey: 'bot:in1:img1' };
    const first = await service.commitBotImages(ws, c.id, input);
    const again = await service.commitBotImages(ws, c.id, input);
    expect(first).toMatchObject({
      direction: 'outbound',
      sender: 'bot',
      text: '',
      attachments: [{ type: 'image', url: input.urls[0] }],
    });
    expect(again).toEqual(first);
    expect(channels.deliver).toHaveBeenCalledTimes(2);
    expect(channels.deliver).toHaveBeenLastCalledWith(
      ws,
      channelId,
      'customer',
      { text: '', attachments: [{ type: 'image', url: input.urls[0] }] },
      'bot:in1:img1',
    );
    await expect(
      service.commitBotImages(ws, c.id, { ...input, urls: ['https://img.example.com/b.jpg'] }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await service.update(ws, c.id, { mode: 'human' }, actor);
    expect(
      await service.commitBotImages(ws, c.id, { urls: input.urls, idempotencyKey: 'bot:in1:img2' }),
    ).toBeNull();
    expect(channels.deliver).toHaveBeenCalledTimes(2);
  });
  it('rejects a bot image that is not https or when the 24-hour window is closed', async () => {
    const c = await service.receive(ws, channelId, event());
    await expect(
      service.commitBotImages(ws, c.id, { urls: ['http://x.example/a.jpg'], idempotencyKey: 'k1' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    vi.advanceTimersByTime(86400000);
    await expect(
      service.commitBotImages(ws, c.id, {
        urls: ['https://x.example/a.jpg'],
        idempotencyKey: 'k2',
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
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
  it('lets staff answer a website visitor 48 hours later (no reply window)', async () => {
    const base = await channels.getConnection(ws, channelId);
    vi.mocked(channels.getConnection).mockResolvedValue({ ...base, provider: 'website' });
    const c = await service.receive(ws, channelId, { ...event(), kind: 'website' });
    vi.advanceTimersByTime(48 * 3_600_000);
    await expect(
      service.send(ws, c.id, { text: 'welcome back', idempotencyKey: newId() }, actor),
    ).resolves.toBeDefined();
    expect(channels.deliver).toHaveBeenCalledTimes(1);
  });
  it('auto-resumes on the next inbound only after the configured human pause', async () => {
    const c = await service.receive(ws, channelId, event());
    await service.send(ws, c.id, { text: 'human', idempotencyKey: newId() }, actor);
    vi.advanceTimersByTime(4 * 60000);
    expect((await service.receive(ws, channelId, event('in2'))).mode).toBe('human');
    vi.advanceTimersByTime(2 * 60000);
    expect((await service.receive(ws, channelId, event('in3'))).mode).toBe('bot');
  });
  it('a bot hand-over resumes the bot by itself after the takeover window', async () => {
    const c = await service.receive(ws, channelId, event());
    expect((await service.handOff(ws, c.id, 'system')).mode).toBe('human');
    vi.advanceTimersByTime(4 * 60000);
    expect((await service.receive(ws, channelId, event('in2'))).mode).toBe('human');
    vi.advanceTimersByTime(2 * 60000);
    expect((await service.receive(ws, channelId, event('in3'))).mode).toBe('bot');
  });
  it('a bot hand-over stays with staff when the bot never resumes automatically', async () => {
    bot.autoResumeAfterManual = false;
    const c = await service.receive(ws, channelId, event());
    await service.handOff(ws, c.id, 'system');
    vi.advanceTimersByTime(3600000);
    expect((await service.receive(ws, channelId, event('in2'))).mode).toBe('human');
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
      { text: '', attachments: [attachment] },
      expect.any(String),
    );
    expect((await service.get(ws, c.id)).conversation.lastMessage).toBe('[image]');
    expect(() =>
      service.send(ws, c.id, { text: 'both', attachment, idempotencyKey: newId() }, actor),
    ).toThrow();
  });
});
describe('ConversationFacade website visitors (T-100)', () => {
  const visitor = '018d0000-0000-7000-8000-00000000abcd';
  const website = () =>
    vi.mocked(channels.getConnection).mockResolvedValue({
      id: channelId,
      provider: 'website' as const,
      externalId: 'wk_site',
      name: 'Site',
      status: 'connected' as const,
      botId,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    } as never);
  const visitorEvent = (id: string, text: string): NormalizedEvent => ({
    kind: 'website',
    assetExternalId: 'wk_site',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: visitor,
    type: 'message',
    occurredAt: new Date(),
    text,
    raw: null,
  });
  it('names a visitor conversation and keeps provider website', async () => {
    website();
    const c = await service.receive(ws, channelId, visitorEvent(newId(), 'Xin chào'));
    expect(c).toMatchObject({ provider: 'website', customerName: 'Khách website abcd' });
  });
  it('lists only what the visitor may see, ascending, with an exclusive cursor', async () => {
    website();
    const first = newId();
    const c = await service.receive(ws, channelId, visitorEvent(first, 'Một'));
    await service.addNote(ws, c.id, 'internal secret', actor);
    await service.send(ws, c.id, { text: 'Staff reply', idempotencyKey: newId() }, actor);
    vi.mocked(channels.deliver).mockResolvedValueOnce({
      externalId: null,
      status: 'failed',
      failureCode: 'x',
    });
    await service.send(ws, c.id, { text: 'Never delivered', idempotencyKey: newId() }, actor);
    const second = newId();
    await service.receive(ws, channelId, visitorEvent(second, 'Hai'));
    const all = await service.listForVisitor(ws, channelId, visitor, null);
    expect(all.conversationId).toBe(c.id);
    expect(all.messages.map((m) => [m.role, m.text, m.clientMessageId])).toEqual([
      ['customer', 'Một', first],
      ['agent', 'Staff reply', null],
      ['customer', 'Hai', second],
    ]);
    expect(JSON.stringify(all)).not.toContain('internal secret');
    const after = await service.listForVisitor(ws, channelId, visitor, all.messages[1]?.id ?? null);
    expect(after.messages.map((m) => m.text)).toEqual(['Hai']);
    expect(await service.listForVisitor(ws, channelId, 'nobody', null)).toEqual({
      conversationId: null,
      messages: [],
    });
  });
  it('does not stall the cursor behind a long run of hidden messages', async () => {
    website();
    const c = await service.receive(ws, channelId, visitorEvent(newId(), 'Một'));
    vi.mocked(channels.deliver).mockResolvedValue({
      externalId: null,
      status: 'failed',
      failureCode: 'x',
    });
    for (let i = 0; i < 6; i++)
      await service.send(ws, c.id, { text: `lost ${i}`, idempotencyKey: newId() }, actor);
    vi.mocked(channels.deliver).mockResolvedValue({
      externalId: 's',
      status: 'sent',
      failureCode: null,
    });
    await service.send(ws, c.id, { text: 'visible', idempotencyKey: newId() }, actor);
    const first = await service.listForVisitor(ws, channelId, visitor, null, 1);
    const next = await service.listForVisitor(
      ws,
      channelId,
      visitor,
      first.messages[0]?.id ?? null,
      2,
    );
    expect(next.messages.map((m) => m.text)).toEqual(['visible']);
  });
});
