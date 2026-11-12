import type { NormalizedEvent } from '@agent-sales/channels';
import { workspaceId, type WorkspaceId } from '@agent-sales/shared';
import { describe, expect, it, vi } from 'vitest';

import { LocalLimiter } from '../../../common/limits/limiter.js';
import type { AiFacade } from '../../ai/api/index.js';
import type { BillingFacade } from '../../billing/api/index.js';
import type { BotFacade, BotView } from '../../bot/api/index.js';
import type { ChannelFacade, PendingMetaEvent } from '../../channel/api/index.js';
import { ConversationFacadeImpl } from '../application/conversation.facade.impl.js';
import { InboxGuards, type InboxLimits } from '../application/inbox-guards.js';
import { MetaInboxProcessor } from '../application/jobs/meta-inbox.processor.js';
import { fakeBilling, fakeCrm, fakeIdentity, fakeTeam } from './fakes.js';
import { MemoryConversationStore } from './factories/memory-conversation-store.js';

const wsA = workspaceId('018d0000-0000-7000-8000-00000000000a');
const wsB = workspaceId('018d0000-0000-7000-8000-00000000000b');
const botId = '018d0000-0000-7000-8000-000000000004';
let seq = 0;

const OFF: InboxLimits = {
  concurrency: 1,
  claimPerWorkspace: 0,
  turnsPerWorkspaceMinute: 0,
  turnsBurst: 1,
  botRepliesPerConversationHour: 0,
  anonymousSiteHour: 0,
  anonymousSiteDay: 0,
  anonymousWorkspaceHour: 0,
  anonymousWorkspaceDay: 0,
};

function job(
  ws: WorkspaceId,
  sender: string,
  text: string,
  kind: 'facebook' | 'website' = 'facebook',
): PendingMetaEvent {
  const id = `ev-${++seq}`;
  const event = {
    kind,
    assetExternalId: 'asset',
    externalEventId: id,
    externalMessageId: id,
    senderExternalId: sender,
    type: 'message',
    occurredAt: new Date(),
    text,
    raw: {},
  } as NormalizedEvent;
  return {
    id: `job-${seq}`,
    claimToken: 't',
    workspaceId: ws,
    connectionId: `${kind}-${ws}`,
    attempt: 1,
    event,
  };
}

function setup(limits: Partial<InboxLimits>, options: { aiDelayMs?: number } = {}) {
  const bot = { id: botId, isActive: true, handoffMessage: 'Staff will help you' } as BotView;
  let sent = 0;
  const channels = {
    getConnection: vi.fn(async (_ws: WorkspaceId, id: string) => ({
      id,
      provider: id.startsWith('website') ? ('website' as const) : ('facebook' as const),
      externalId: 'asset',
      name: 'Asset',
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
    deferEvent: vi.fn(async () => undefined),
    hasNewerCustomerEvent: vi.fn(async () => false),
    unbindBot: vi.fn(async () => 0),
  } as unknown as ChannelFacade & {
    claimEvents: ReturnType<typeof vi.fn>;
    deferEvent: ReturnType<typeof vi.fn>;
  };
  const bots: BotFacade = { getBot: async () => bot } as unknown as BotFacade;
  const inbox = new ConversationFacadeImpl(
    new MemoryConversationStore(),
    channels,
    bots,
    fakeTeam(),
    fakeIdentity(),
    fakeCrm() as never,
  );
  let running = 0;
  let maxRunning = 0;
  const ai = {
    reply: vi.fn(async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, options.aiDelayMs ?? 0));
      running--;
      return { reply: 'answer', outcome: 'answered' };
    }),
  } as unknown as AiFacade & { reply: ReturnType<typeof vi.fn> };
  const limiter = new LocalLimiter();
  const notify = vi.fn(async () => undefined);
  const guards = new InboxGuards({ ...OFF, ...limits }, limiter, limiter, notify);
  const billing = fakeBilling();
  const processor = new MetaInboxProcessor(
    channels,
    inbox,
    ai,
    bots,
    billing as unknown as BillingFacade,
    { fetch: async () => null },
    false,
    undefined,
    { now: () => 0, sleep: async () => undefined },
    guards,
  );
  const texts = () =>
    (channels.deliver as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => (c[3] as { text: string }).text,
    );
  return { channels, ai, inbox, processor, notify, billing, texts, maxRunning: () => maxRunning };
}

describe('MetaInboxProcessor guards (security audit 2026-11-12)', () => {
  it('claims with a per-workspace cap when one is configured', async () => {
    const { channels, processor } = setup({ claimPerWorkspace: 3 });
    await processor.tick();
    expect(channels.claimEvents).toHaveBeenCalledWith(25, { perWorkspace: 3 });
  });

  it('answers different conversations concurrently, bounded by the concurrency limit', async () => {
    const { channels, ai, processor, maxRunning } = setup({ concurrency: 2 }, { aiDelayMs: 30 });
    channels.claimEvents.mockResolvedValueOnce([
      job(wsA, 'c1', 'hi'),
      job(wsA, 'c2', 'hi'),
      job(wsB, 'c3', 'hi'),
      job(wsB, 'c4', 'hi'),
    ]);
    await processor.tick();
    expect(ai.reply).toHaveBeenCalledTimes(4);
    expect(maxRunning()).toBe(2);
  });

  it('defers a turn without a model call once the workspace turn budget is spent', async () => {
    const { channels, ai, processor } = setup({ turnsPerWorkspaceMinute: 60, turnsBurst: 1 });
    channels.claimEvents.mockResolvedValueOnce([job(wsA, 'c1', 'one'), job(wsB, 'c2', 'two')]);
    await processor.tick();
    expect(ai.reply).toHaveBeenCalledTimes(2);
    const late = job(wsA, 'c3', 'three');
    channels.claimEvents.mockResolvedValueOnce([late]);
    await processor.tick();
    expect(ai.reply).toHaveBeenCalledTimes(2);
    expect(channels.deferEvent).toHaveBeenCalledWith(late.id, 't', expect.any(Number));
    expect(channels.deferEvent.mock.calls[0]![2]).toBeGreaterThan(0);
    expect(channels.completeEvent).not.toHaveBeenCalledWith(late.id, 't');
  });

  it('hands a conversation to staff once its hourly bot replies are spent', async () => {
    const { channels, ai, inbox, processor, texts } = setup({ botRepliesPerConversationHour: 2 });
    for (const text of ['one', 'two', 'three']) {
      channels.claimEvents.mockResolvedValueOnce([job(wsA, 'c1', text)]);
      await processor.tick();
    }
    expect(ai.reply).toHaveBeenCalledTimes(2);
    expect(texts().at(-1)).toBe('Staff will help you');
    const [c] = (await inbox.list(wsA, { limit: 10 } as never)).data;
    expect(c?.mode).toBe('human');
  });

  it('caps AI replies to anonymous website visitors: a polite message once, owner told once', async () => {
    const { channels, ai, inbox, processor, notify, billing, texts } = setup({
      anonymousSiteHour: 2,
    });
    for (const sender of ['v1', 'v2', 'v3']) {
      channels.claimEvents.mockResolvedValueOnce([job(wsA, sender, 'hello', 'website')]);
      await processor.tick();
    }
    expect(ai.reply).toHaveBeenCalledTimes(2);
    expect(texts().at(-1)).toBe('Staff will help you');
    // The capped visitor writes again: nothing more is sent, no model call.
    channels.claimEvents.mockResolvedValueOnce([job(wsA, 'v3', 'anyone?', 'website')]);
    await processor.tick();
    expect(ai.reply).toHaveBeenCalledTimes(2);
    expect(texts()).toHaveLength(3);
    // A fourth visitor is capped too; the owner was told once for the window.
    channels.claimEvents.mockResolvedValueOnce([job(wsA, 'v4', 'hi', 'website')]);
    await processor.tick();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      wsA,
      expect.objectContaining({ scope: 'site', window: 'hour' }),
    );
    // Capped conversations stay with the bot (no hand-off alert flood) and are not billed.
    const list = (await inbox.list(wsA, { limit: 10 } as never)).data;
    expect(list.every((c) => c.mode === 'bot')).toBe(true);
    expect(billing.reserveReply).toHaveBeenCalledTimes(2);
  });

  it('does not count Messenger customers against the anonymous website caps', async () => {
    const { channels, ai, processor } = setup({ anonymousSiteHour: 1, anonymousWorkspaceDay: 1 });
    for (const sender of ['c1', 'c2', 'c3']) {
      channels.claimEvents.mockResolvedValueOnce([job(wsA, sender, 'hello')]);
      await processor.tick();
    }
    expect(ai.reply).toHaveBeenCalledTimes(3);
  });
});
