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

describe('care messages', () => {
  it('sends a care message as a bot message marked care, without taking the conversation', async () => {
    const service = facade();
    const c = await service.receive(ws, channelId, event());
    vi.advanceTimersByTime(2 * H);
    const sent = await service.commitCareMessage(ws, c.id, {
      text: 'Dạ mẫu này vẫn còn ạ',
      idempotencyKey: 'care:1',
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
    });
    expect(channels.deliver).toHaveBeenCalledTimes(1);
    const completed = store.events.find(
      (e) => (e as { type: string }).type === 'conversation.reply.completed.v1',
    ) as { payload: Record<string, unknown> };
    expect(completed.payload).toMatchObject({ sender: 'bot', source: 'care' });
  });

  it('never sends a care message after 24 hours, even with the HUMAN_AGENT flag on', async () => {
    const service = facade(true);
    const c = await service.receive(ws, channelId, event());
    vi.advanceTimersByTime(25 * H);
    await expect(
      service.commitCareMessage(ws, c.id, { text: 'Chào anh', idempotencyKey: 'care:2' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(channels.deliver).not.toHaveBeenCalled();
  });

  it('refuses a closed conversation, empty text and another workspace', async () => {
    const service = facade();
    const c = await service.receive(ws, channelId, event());
    await service.update(ws, c.id, { status: 'resolved', expectedRevision: c.revision }, actor);
    await expect(
      service.commitCareMessage(ws, c.id, { text: 'Chào anh', idempotencyKey: 'care:3' }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(
      service.commitCareMessage(ws, c.id, { text: '  ', idempotencyKey: 'care:4' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(
      service.commitCareMessage(other, c.id, { text: 'Chào anh', idempotencyKey: 'care:5' }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('reads the follow-up facts and the delivered outbound timeline', async () => {
    const service = facade();
    const c = await service.receive(ws, channelId, event());
    vi.advanceTimersByTime(H);
    await service.commitCareMessage(ws, c.id, { text: 'Dạ', idempotencyKey: 'care:6' });
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
    const timeline = await service.outboundTimeline(ws, [c.id, 'x'], {
      since: new Date('2026-11-11T00:00:00Z'),
      until: new Date('2026-11-12T00:00:00Z'),
    });
    expect(timeline.map((t) => [t.sender, t.source, t.at])).toEqual([
      ['bot', 'care', '2026-11-11T04:00:00.000Z'],
      ['human', null, '2026-11-11T05:00:00.000Z'],
    ]);
    expect(
      await service.outboundTimeline(other, [c.id], {
        since: new Date(0),
        until: new Date('2030-01-01T00:00:00Z'),
      }),
    ).toEqual([]);
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
