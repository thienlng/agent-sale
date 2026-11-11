import type { NormalizedEvent } from '@agent-sales/channels';
import { newId, workspaceId } from '@agent-sales/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { ChannelFacade } from '../../channel/api/index.js';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { MemoryConversationStore } from './factories/memory-conversation-store.js';
import { fakeCrm, fakeIdentity, fakeTeam } from './fakes.js';

/**
 * The conversation side of the care agent (ADR-031): care messages are bot messages marked
 * `source: 'care'` inside the 24-hour window only, and a member's manual reply may use the
 * `HUMAN_AGENT` tag up to 7 days when the env flag is on. The channel is a fake: no Meta call.
 */
const ws = workspaceId('018d0000-0000-7000-8000-000000000101');
const other = workspaceId('018d0000-0000-7000-8000-000000000102');
const channelId = '018d0000-0000-7000-8000-000000000103';
const botId = '018d0000-0000-7000-8000-000000000104';
const actor = '018d0000-0000-7000-8000-000000000105';
const H = 3_600_000;

let store: MemoryConversationStore;
let channels: ChannelFacade;
let provider: 'facebook' | 'instagram' | 'website';

function event(id = 'in1', type: 'message' | 'echo' = 'message'): NormalizedEvent {
  return {
    kind: provider,
    assetExternalId: 'page',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: 'customer',
    type,
    occurredAt: new Date(),
    text: 'Còn hàng không ạ?',
    raw: {},
  };
}

function facade(humanAgentTag?: boolean): ConversationFacadeImpl {
  const bot = { id: botId, isActive: true, humanTakeoverMinutes: 5 } as unknown as BotView;
  const bots: BotFacade = { getBot: async () => bot };
  return new ConversationFacadeImpl(
    store,
    channels,
    bots,
    fakeTeam(),
    fakeIdentity({ [actor]: 'Lan' }),
    fakeCrm() as never,
    undefined,
    undefined,
    humanAgentTag,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-11T03:00:00Z'));
  store = new MemoryConversationStore();
  provider = 'facebook';
  channels = {
    getConnection: vi.fn(async () => ({
      id: channelId,
      provider,
      externalId: 'page',
      name: 'Page',
      status: 'connected' as const,
      botId,
      expiresAt: null,
      createdAt: new Date().toISOString(),
    })),
    deliver: vi.fn(async () => ({
      externalId: 'm-out',
      status: 'sent' as const,
      failureCode: null,
    })),
  } as unknown as ChannelFacade;
});
afterEach(() => vi.useRealTimers());

/** The customer asked, the bot answered: what a follow-up is written for (anchor = the ask). */
async function answered(service: ConversationFacadeImpl, id = 'in1') {
  const c = await service.receive(ws, channelId, event(id));
  await service.commitBotReply(ws, c.id, {
    revision: c.revision,
    text: 'Dạ còn ạ',
    idempotencyKey: `bot:${id}`,
  });
  vi.mocked(channels.deliver).mockClear();
  return { id: c.id, anchorAt: new Date(c.lastInboundAt) };
}

describe('care messages', () => {
  it('sends a care message as a bot message marked care, without taking the conversation', async () => {
    const service = facade();
    const c = await answered(service);
    vi.advanceTimersByTime(2 * H);
    const sent = await service.commitCareMessage(ws, c.id, {
      text: 'Dạ mẫu này vẫn còn ạ',
      idempotencyKey: 'care:1',
      anchorAt: c.anchorAt,
    });
    expect(sent).toMatchObject({ sender: 'bot', source: 'care', status: 'sent' });
    expect(sent).not.toHaveProperty('tag');
    expect(vi.mocked(channels.deliver).mock.calls[0]?.[3]).not.toHaveProperty('tag');
    const { conversation } = await service.get(ws, c.id);
    expect(conversation.mode).toBe('bot');
    // Idempotent: the same key returns the stored message without a second delivery.
    await service.commitCareMessage(ws, c.id, {
      text: 'Dạ mẫu này vẫn còn ạ',
      idempotencyKey: 'care:1',
      anchorAt: c.anchorAt,
    });
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    const completed = store.events.find(
      (e) =>
        (e as { type: string }).type === 'conversation.reply.completed.v1' &&
        (e as { payload: { source?: string } }).payload.source === 'care',
    ) as { payload: Record<string, unknown> };
    expect(completed.payload).toMatchObject({ sender: 'bot', source: 'care' });
  });

  it('refuses when the customer wrote after the anchor or is waiting, and when a person holds it', async () => {
    const service = facade();
    const c = await answered(service);
    vi.advanceTimersByTime(H);
    // The customer wrote again (nobody answered yet): refused, nothing delivered.
    await service.receive(ws, channelId, event('in2'));
    await expect(
      service.commitCareMessage(ws, c.id, {
        text: 'Anh còn quan tâm không ạ?',
        idempotencyKey: 'care:r1',
        anchorAt: c.anchorAt,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'customer_replied' } });
    expect(channels.deliver).not.toHaveBeenCalled();
    // The conversation stays waiting for an answer.
    expect((await service.get(ws, c.id)).conversation.awaitingSince).not.toBeNull();

    // The bot answered again; then a person takes the conversation.
    const d = await answered(service, 'in3');
    await service.update(ws, d.id, { mode: 'human' }, actor);
    await expect(
      service.commitCareMessage(ws, d.id, {
        text: 'Dạ',
        idempotencyKey: 'care:r2',
        anchorAt: d.anchorAt,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'taken_over' } });
    expect(channels.deliver).not.toHaveBeenCalled();
  });

  it('never sends a care message after 24 hours, even with the HUMAN_AGENT flag on', async () => {
    const service = facade(true);
    const c = await answered(service);
    vi.advanceTimersByTime(25 * H);
    await expect(
      service.commitCareMessage(ws, c.id, {
        text: 'Chào anh',
        idempotencyKey: 'care:2',
        anchorAt: c.anchorAt,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'window_closed' } });
    expect(channels.deliver).not.toHaveBeenCalled();
  });

  it('refuses a closed conversation, empty text and another workspace', async () => {
    const service = facade();
    const c = await answered(service);
    const { conversation } = await service.get(ws, c.id);
    await service.update(
      ws,
      c.id,
      { status: 'resolved', expectedRevision: conversation.revision },
      actor,
    );
    const input = { text: 'Chào anh', anchorAt: c.anchorAt };
    await expect(
      service.commitCareMessage(ws, c.id, { ...input, idempotencyKey: 'care:3' }),
    ).rejects.toMatchObject({ code: 'CONFLICT', details: { reason: 'conversation_closed' } });
    await expect(
      service.commitCareMessage(ws, c.id, { ...input, text: '  ', idempotencyKey: 'care:4' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.commitCareMessage(other, c.id, { ...input, idempotencyKey: 'care:5' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reads the follow-up facts and the AI touches before a sale', async () => {
    const service = facade();
    const c = await answered(service);
    vi.advanceTimersByTime(H);
    await service.commitCareMessage(ws, c.id, {
      text: 'Dạ',
      idempotencyKey: 'care:6',
      anchorAt: c.anchorAt,
    });
    vi.advanceTimersByTime(H);
    await service.send(ws, c.id, { text: 'Em Lan đây ạ', idempotencyKey: newId() }, actor);
    const facts = await service.followUpFacts(ws, c.id);
    expect(facts).toMatchObject({
      id: c.id,
      provider: 'facebook',
      status: 'open',
      mode: 'human',
      lastInboundAt: '2026-11-11T03:00:00.000Z',
      lastMessageSender: 'human',
      lastHumanAt: '2026-11-11T05:00:00.000Z',
    });
    expect(await service.followUpFacts(other, c.id)).toBeNull();
    expect(await service.followUpFacts(ws, 'not-a-uuid')).toBeNull();
    const week = 7 * 24 * H;
    const touches = await service.aiTouches(
      ws,
      [
        { conversationId: c.id, at: new Date('2026-11-11T06:00:00Z') },
        { conversationId: 'x', at: new Date('2026-11-11T06:00:00Z') },
        { conversationId: c.id, at: new Date('2026-11-11T04:30:00Z') },
        { conversationId: c.id, at: new Date('2026-11-20T00:00:00Z') },
      ],
      week,
    );
    expect(touches).toEqual([
      // The bot's answer (03:00) is the first AI touch; Lan wrote at 05:00.
      { firstBotAt: '2026-11-11T03:00:00.000Z', staffAfter: true },
      { firstBotAt: null, staffAfter: false },
      { firstBotAt: '2026-11-11T03:00:00.000Z', staffAfter: false },
      { firstBotAt: null, staffAfter: false },
    ]);
    expect(
      await service.aiTouches(other, [{ conversationId: c.id, at: new Date() }], week),
    ).toEqual([{ firstBotAt: null, staffAfter: false }]);
  });
});

describe('HUMAN_AGENT for members (META_HUMAN_AGENT_TAG)', () => {
  it.each(['facebook', 'instagram'] as const)(
    'tags a member reply between 24 hours and 7 days on %s when the flag is on',
    async (kind) => {
      provider = kind;
      const service = facade(true);
      const c = await service.receive(ws, channelId, event());
      vi.advanceTimersByTime(3 * 24 * H);
      const sent = await service.send(
        ws,
        c.id,
        { text: 'Dạ shop gửi anh báo giá ạ', idempotencyKey: newId() },
        actor,
      );
      expect(sent).toMatchObject({ sender: 'human', tag: 'HUMAN_AGENT', status: 'sent' });
      expect(vi.mocked(channels.deliver).mock.calls[0]?.[3]).toMatchObject({ tag: 'HUMAN_AGENT' });
    },
  );

  it('does not tag a reply inside 24 hours', async () => {
    const service = facade(true);
    const c = await service.receive(ws, channelId, event());
    vi.advanceTimersByTime(23 * H);
    const sent = await service.send(ws, c.id, { text: 'Dạ', idempotencyKey: newId() }, actor);
    expect(sent).not.toHaveProperty('tag');
    expect(vi.mocked(channels.deliver).mock.calls[0]?.[3]).not.toHaveProperty('tag');
  });

  it('refuses a member reply after 7 days, and after 24 hours while the flag is off', async () => {
    const on = facade(true);
    const c = await on.receive(ws, channelId, event());
    vi.advanceTimersByTime(7 * 24 * H);
    await expect(
      on.send(ws, c.id, { text: 'Muộn rồi', idempotencyKey: newId() }, actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    const off = facade();
    await expect(
      off.send(ws, c.id, { text: 'Muộn rồi', idempotencyKey: newId() }, actor),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(channels.deliver).not.toHaveBeenCalled();
  });

  it('tells the inbox whether a member may reply with the tag (Meta channels, flag on)', async () => {
    const c = await facade(true).receive(ws, channelId, event());
    expect((await facade(true).get(ws, c.id)).humanAgentReply).toBe(true);
    expect((await facade().get(ws, c.id)).humanAgentReply).toBe(false);
  });

  it('never offers the tag on the website', async () => {
    provider = 'website';
    const site = await facade(true).receive(ws, channelId, event());
    expect((await facade(true).get(ws, site.id)).humanAgentReply).toBe(false);
  });

  it('never tags a bot reply', async () => {
    const service = facade(true);
    const c = await service.receive(ws, channelId, event());
    vi.advanceTimersByTime(25 * H);
    await expect(
      service.commitBotFollowUp(ws, c.id, { text: 'Bot', idempotencyKey: 'bot:x' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(channels.deliver).not.toHaveBeenCalled();
  });
});
